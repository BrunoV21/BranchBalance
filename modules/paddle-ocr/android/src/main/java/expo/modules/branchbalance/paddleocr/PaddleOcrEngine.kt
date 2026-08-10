package expo.modules.branchbalance.paddleocr

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import org.opencv.android.Utils
import org.opencv.core.Core
import org.opencv.core.CvType
import org.opencv.core.Mat
import org.opencv.core.MatOfPoint
import org.opencv.core.MatOfPoint2f
import org.opencv.core.Point
import org.opencv.core.RotatedRect
import org.opencv.core.Scalar
import org.opencv.core.Size
import org.opencv.imgproc.Imgproc
import java.io.Closeable
import java.nio.FloatBuffer
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

internal class PaddleOcrEngine(
  private val context: Context,
  private val assetRoot: String,
) : Closeable {
  private val environment = OrtEnvironment.getEnvironment()
  private val sessionOptions = OrtSession.SessionOptions().apply {
    setIntraOpNumThreads(max(1, min(4, Runtime.getRuntime().availableProcessors() - 1)))
    setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
  }
  private val detection = loadSession("text_detection.onnx")
  private val recognition = loadSession("text_recognition.onnx")
  private val orientation = loadSession("text_orientation.onnx")
  private val characters = context.assets.open("$assetRoot/characters.txt").bufferedReader().use { it.readLines() }

  fun recognize(imageUri: String, profile: OcrProfile, isCancelled: () -> Boolean): Map<String, Any> {
    checkCancelled(isCancelled)
    val bitmap = loadBitmap(imageUri) ?: throw ImageUnreadableException()
    if (bitmap.width !in 1..2048 || bitmap.height !in 1..2048) {
      bitmap.recycle()
      throw ImageUnreadableException()
    }
    val original = Mat()
    try {
      Utils.bitmapToMat(bitmap, original)
    } finally {
      bitmap.recycle()
    }
    Imgproc.cvtColor(original, original, Imgproc.COLOR_RGBA2BGR)
    try {
      val boxes = detect(original, profile, isCancelled)
      val blocks = mutableListOf<Map<String, Any>>()
      for (box in boxes.take(profile.maxRegions)) {
        checkCancelled(isCancelled)
        val crop = perspectiveCrop(original, box)
        try {
          if (shouldRotate(crop, isCancelled)) Core.rotate(crop, crop, Core.ROTATE_180)
          val recognized = recognizeLine(crop, profile, isCancelled)
          if (recognized.text.isNotBlank()) {
            blocks += mapOf(
              "text" to recognized.text.take(256),
              "confidence" to recognized.confidence.coerceIn(0.0, 1.0),
              "points" to box.map { point -> mapOf("x" to point.x.coerceIn(0.0, original.cols().toDouble()), "y" to point.y.coerceIn(0.0, original.rows().toDouble())) },
            )
          }
        } finally {
          crop.release()
        }
      }
      return mapOf("width" to original.cols(), "height" to original.rows(), "blocks" to blocks)
    } finally {
      original.release()
    }
  }

  private fun detect(image: Mat, profile: OcrProfile, isCancelled: () -> Boolean): List<List<Point>> {
    val longEdge = max(image.cols(), image.rows())
    val ratio = profile.longEdge.toDouble() / longEdge
    val width = max(32, ((image.cols() * ratio / 32.0).roundToInt() * 32))
    val height = max(32, ((image.rows() * ratio / 32.0).roundToInt() * 32))
    val resized = Mat()
    Imgproc.resize(image, resized, Size(width.toDouble(), height.toDouble()))
    try {
      val input = normalizedTensor(resized, floatArrayOf(0.485f, 0.456f, 0.406f), floatArrayOf(0.229f, 0.224f, 0.225f))
      checkCancelled(isCancelled)
      val output = runDetection(input, height, width)
      val probability = Mat(height, width, CvType.CV_32F)
      probability.put(0, 0, output)
      val binary = Mat()
      Imgproc.threshold(probability, binary, profile.detectionThreshold, 255.0, Imgproc.THRESH_BINARY)
      binary.convertTo(binary, CvType.CV_8U)
      val contours = mutableListOf<MatOfPoint>()
      val hierarchy = Mat()
      Imgproc.findContours(binary, contours, hierarchy, Imgproc.RETR_LIST, Imgproc.CHAIN_APPROX_SIMPLE)
      hierarchy.release()
      binary.release()
      val scaleX = image.cols().toDouble() / width
      val scaleY = image.rows().toDouble() / height
      val boxes = contours.asSequence().mapNotNull { contour ->
        try {
          if (Imgproc.contourArea(contour) < 12.0) return@mapNotNull null
          val mask = Mat.zeros(height, width, CvType.CV_8U)
          Imgproc.drawContours(mask, listOf(contour), 0, Scalar(255.0), -1)
          val score = Core.mean(probability, mask).`val`[0]
          mask.release()
          if (score < profile.boxThreshold) return@mapNotNull null
          val points2f = MatOfPoint2f(*contour.toArray())
          val rect = Imgproc.minAreaRect(points2f)
          points2f.release()
          if (min(rect.size.width, rect.size.height) < 3.0) return@mapNotNull null
          val perimeter = 2.0 * (rect.size.width + rect.size.height)
          val distance = rect.size.area() * profile.unclipRatio / max(1.0, perimeter)
          val expanded = RotatedRect(rect.center, Size(rect.size.width + 2 * distance, rect.size.height + 2 * distance), rect.angle)
          val rawPoints = arrayOf(Point(), Point(), Point(), Point())
          expanded.points(rawPoints)
          orderPoints(rawPoints.map { Point(it.x * scaleX, it.y * scaleY) })
        } finally {
          contour.release()
        }
      }.sortedWith(compareBy<List<Point>> { it.sumOf { point -> point.y } / 4.0 }.thenBy { it.sumOf { point -> point.x } / 4.0 }).take(profile.maxRegions).toList()
      probability.release()
      return boxes
    } finally {
      resized.release()
    }
  }

  private fun runDetection(data: FloatArray, height: Int, width: Int): FloatArray {
    OnnxTensor.createTensor(environment, FloatBuffer.wrap(data), longArrayOf(1, 3, height.toLong(), width.toLong())).use { tensor ->
      detection.run(mapOf(detection.inputNames.first() to tensor)).use { results ->
        @Suppress("UNCHECKED_CAST")
        val value = results[0].value as Array<Array<Array<FloatArray>>>
        return value[0][0].flatMap { it.asIterable() }.toFloatArray()
      }
    }
  }

  private fun shouldRotate(crop: Mat, isCancelled: () -> Boolean): Boolean {
    val resized = Mat()
    Imgproc.resize(crop, resized, Size(160.0, 80.0))
    return try {
      val data = normalizedTensor(resized, floatArrayOf(0.485f, 0.456f, 0.406f), floatArrayOf(0.229f, 0.224f, 0.225f))
      checkCancelled(isCancelled)
      OnnxTensor.createTensor(environment, FloatBuffer.wrap(data), longArrayOf(1, 3, 80, 160)).use { tensor ->
        orientation.run(mapOf(orientation.inputNames.first() to tensor)).use { results ->
          @Suppress("UNCHECKED_CAST")
          val scores = (results[0].value as Array<FloatArray>)[0]
          scores.size >= 2 && scores[1] > scores[0] && scores[1] >= 0.80f
        }
      }
    } finally {
      resized.release()
    }
  }

  private fun recognizeLine(crop: Mat, profile: OcrProfile, isCancelled: () -> Boolean): RecognizedLine {
    val ratio = crop.cols().toDouble() / max(1, crop.rows())
    val contentWidth = max(1, min(profile.maxRecognitionWidth, ceil(48 * ratio).toInt()))
    val tensorWidth = max(320, ((contentWidth + 31) / 32) * 32)
    val resized = Mat()
    Imgproc.resize(crop, resized, Size(contentWidth.toDouble(), 48.0))
    val padded = Mat.zeros(48, tensorWidth, CvType.CV_8UC3)
    val target = padded.submat(0, 48, 0, contentWidth)
    resized.copyTo(target)
    target.release()
    resized.release()
    try {
      val data = normalizedTensor(padded, floatArrayOf(0.5f, 0.5f, 0.5f), floatArrayOf(0.5f, 0.5f, 0.5f))
      checkCancelled(isCancelled)
      OnnxTensor.createTensor(environment, FloatBuffer.wrap(data), longArrayOf(1, 3, 48, tensorWidth.toLong())).use { tensor ->
        recognition.run(mapOf(recognition.inputNames.first() to tensor)).use { results ->
          @Suppress("UNCHECKED_CAST")
          val timesteps = (results[0].value as Array<Array<FloatArray>>)[0]
          val text = StringBuilder()
          var lastIndex = -1
          var confidenceSum = 0.0
          var count = 0
          for (scores in timesteps) {
            var bestIndex = 0
            var bestScore = scores[0]
            for (index in 1 until scores.size) if (scores[index] > bestScore) { bestIndex = index; bestScore = scores[index] }
            if (bestIndex != 0 && bestIndex != lastIndex) {
              val character = when {
                bestIndex - 1 < characters.size -> characters[bestIndex - 1]
                bestIndex == characters.size + 1 -> " "
                else -> ""
              }
              text.append(character)
              confidenceSum += bestScore
              count += 1
            }
            lastIndex = bestIndex
          }
          return RecognizedLine(text.toString().trim(), if (count == 0) 0.0 else confidenceSum / count)
        }
      }
    } finally {
      padded.release()
    }
  }

  private fun normalizedTensor(image: Mat, means: FloatArray, stds: FloatArray): FloatArray {
    require(image.type() == CvType.CV_8UC3)
    val area = image.rows() * image.cols()
    val bytes = ByteArray(area * 3)
    image.get(0, 0, bytes)
    val output = FloatArray(area * 3)
    for (index in 0 until area) for (channel in 0..2) {
      val value = (bytes[index * 3 + channel].toInt() and 0xff) / 255.0f
      output[channel * area + index] = (value - means[channel]) / stds[channel]
    }
    return output
  }

  private fun perspectiveCrop(image: Mat, raw: List<Point>): Mat {
    val points = orderPoints(raw)
    val width = max(distance(points[0], points[1]), distance(points[2], points[3])).roundToInt().coerceAtLeast(1)
    val height = max(distance(points[0], points[3]), distance(points[1], points[2])).roundToInt().coerceAtLeast(1)
    val source = MatOfPoint2f(*points.toTypedArray())
    val target = MatOfPoint2f(Point(0.0, 0.0), Point(width - 1.0, 0.0), Point(width - 1.0, height - 1.0), Point(0.0, height - 1.0))
    val transform = Imgproc.getPerspectiveTransform(source, target)
    val crop = Mat()
    Imgproc.warpPerspective(image, crop, transform, Size(width.toDouble(), height.toDouble()), Imgproc.INTER_CUBIC, Core.BORDER_REPLICATE)
    source.release(); target.release(); transform.release()
    return crop
  }

  private fun orderPoints(points: List<Point>): List<Point> {
    val topLeft = points.minBy { it.x + it.y }
    val bottomRight = points.maxBy { it.x + it.y }
    val topRight = points.maxBy { it.x - it.y }
    val bottomLeft = points.minBy { it.x - it.y }
    return listOf(topLeft, topRight, bottomRight, bottomLeft)
  }

  private fun distance(left: Point, right: Point) = kotlin.math.hypot(left.x - right.x, left.y - right.y)

  private fun loadBitmap(value: String): Bitmap? {
    val uri = Uri.parse(value)
    return when (uri.scheme) {
      null, "file" -> BitmapFactory.decodeFile(uri.path ?: value)
      else -> context.contentResolver.openInputStream(uri)?.use(BitmapFactory::decodeStream)
    }
  }

  private fun loadSession(file: String): OrtSession = context.assets.open("$assetRoot/$file").use { input -> environment.createSession(input.readBytes(), sessionOptions) }

  private fun checkCancelled(isCancelled: () -> Boolean) {
    if (isCancelled()) throw CancelledException()
  }

  override fun close() {
    detection.close()
    recognition.close()
    orientation.close()
    sessionOptions.close()
  }

  private data class RecognizedLine(val text: String, val confidence: Double)
}
