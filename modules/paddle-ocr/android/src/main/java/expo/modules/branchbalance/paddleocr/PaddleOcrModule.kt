package expo.modules.branchbalance.paddleocr

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.opencv.android.OpenCVLoader
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

private const val MODULE_NAME = "BranchBalancePaddleOCR"
internal const val MODEL_BUNDLE_VERSION = "ppocr-v5-mobile-latin-2026-07-20"
private const val ASSET_ROOT = "paddle_ocr"

class RecognizeOptions : Record {
  @Field lateinit var requestId: String
  @Field lateinit var imageUri: String
}

class ModelsMissingException : CodedException("The local OCR models are missing from this build.")
class ModelsIncompatibleException : CodedException("The local OCR models are incompatible with this build.")
class ImageUnreadableException(cause: Throwable? = null) : CodedException("This image could not be read.", cause)
class InferenceFailedException(cause: Throwable? = null) : CodedException("Local receipt inference failed.", cause)
class CancelledException : CodedException("Receipt reading was cancelled.")
class OutOfMemoryException(cause: Throwable? = null) : CodedException("The receipt was too large to read on this device.", cause)

class PaddleOcrModule : Module() {
  private val cancellations = ConcurrentHashMap<String, AtomicBoolean>()
  private var engine: PaddleOcrEngine? = null

  override fun definition() = ModuleDefinition {
    Name(MODULE_NAME)

    AsyncFunction("getStatus").Coroutine<Map<String, Any?>> {
      val context = requireNotNull(appContext.reactContext)
      val assets = context.assets
      val required = listOf("model-bundle.json", "text_detection.onnx", "text_recognition.onnx", "text_orientation.onnx", "characters.txt")
      if (required.any { runCatching { assets.open("$ASSET_ROOT/$it").use { stream -> stream.read() } }.isFailure }) {
        return@Coroutine status("models_missing", null, "The local OCR models are missing from this build.")
      }
      val manifest = assets.open("$ASSET_ROOT/model-bundle.json").bufferedReader().use { it.readText() }
      if (!manifest.contains("\"bundleVersion\": \"$MODEL_BUNDLE_VERSION\"")) {
        return@Coroutine status("models_incompatible", null, "The local OCR model bundle does not match this app build.")
      }
      if (!OpenCVLoader.initLocal()) {
        return@Coroutine status("models_incompatible", null, "The local image-processing runtime could not be loaded.")
      }
      status("ready", MODEL_BUNDLE_VERSION, "Receipt scanning is ready.")
    }

    AsyncFunction("recognize") Coroutine { options: RecognizeOptions ->
      val cancelled = AtomicBoolean(false)
      cancellations[options.requestId] = cancelled
      try {
        withContext(Dispatchers.Default) {
          if (cancelled.get()) throw CancelledException()
          val context = requireNotNull(appContext.reactContext)
          val activeEngine = synchronized(this@PaddleOcrModule) {
            engine ?: PaddleOcrEngine(context, ASSET_ROOT).also { engine = it }
          }
          activeEngine.recognize(options.imageUri) { cancelled.get() }
        }
      } catch (error: CancelledException) {
        throw error
      } catch (error: OutOfMemoryError) {
        throw OutOfMemoryException(error)
      } catch (error: CodedException) {
        throw error
      } catch (error: Throwable) {
        throw InferenceFailedException(error)
      } finally {
        cancellations.remove(options.requestId)
      }
    }

    AsyncFunction("cancel") { requestId: String ->
      cancellations[requestId]?.set(true)
    }

    OnDestroy {
      cancellations.values.forEach { it.set(true) }
      cancellations.clear()
      engine?.close()
      engine = null
    }
  }

  private fun status(state: String, version: String?, message: String) = mapOf(
    "state" to state,
    "engine" to "paddle_ocr",
    "modelBundleVersion" to version,
    "safeMessage" to message,
  )
}
