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
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

private const val MODULE_NAME = "BranchBalancePaddleOCR"
internal const val MODEL_BUNDLE_VERSION = "ppocr-v5-mobile-latin-2026-07-20"
private const val ASSET_ROOT = "paddle_ocr"

class RecognizeOptions : Record {
  @Field lateinit var requestId: String
  @Field lateinit var imageUri: String
  @Field lateinit var profile: String
}

internal data class OcrProfile(
  val id: String,
  val version: String,
  val longEdge: Int,
  val detectionThreshold: Double,
  val boxThreshold: Double,
  val unclipRatio: Double,
  val maxRegions: Int,
  val maxRecognitionWidth: Int,
)

private val PROFILES = mapOf(
  "generic_v1" to OcrProfile("generic_v1", "generic-v1-2026-08-10", 960, 0.30, 0.60, 1.5, 192, 960),
  "fuel_v1" to OcrProfile("fuel_v1", "fuel-v1-2026-08-10", 1280, 0.30, 0.60, 1.5, 160, 960),
)

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

    AsyncFunction("getStatus").Coroutine { profileId: String ->
      val context = requireNotNull(appContext.reactContext)
      val assets = context.assets
      val profile = PROFILES[profileId]
        ?: return@Coroutine status("models_incompatible", profileId, null, null, "The selected receipt profile is unavailable in this build.")
      val required = listOf("model-bundle.json", "profile-manifest.json", "text_detection.onnx", "text_recognition.onnx", "text_orientation.onnx", "characters.txt")
      if (required.any { runCatching { assets.open("$ASSET_ROOT/$it").use { stream -> stream.read() } }.isFailure }) {
        return@Coroutine status("models_missing", profile.id, null, null, "The local OCR models are missing from this build.")
      }
      val manifest = assets.open("$ASSET_ROOT/model-bundle.json").bufferedReader().use { it.readText() }
      if (!manifest.contains("\"bundleVersion\": \"$MODEL_BUNDLE_VERSION\"")) {
        return@Coroutine status("models_incompatible", profile.id, null, null, "The local OCR model bundle does not match this app build.")
      }
      val profileManifest = JSONObject(assets.open("$ASSET_ROOT/profile-manifest.json").bufferedReader().use { it.readText() })
      val packagedProfile = profileManifest.getJSONObject("profiles").optJSONObject(profile.id)
      if (packagedProfile?.optString("version") != profile.version) {
        return@Coroutine status("models_incompatible", profile.id, null, MODEL_BUNDLE_VERSION, "The selected receipt profile does not match this app build.")
      }
      if (!OpenCVLoader.initLocal()) {
        return@Coroutine status("models_incompatible", profile.id, null, MODEL_BUNDLE_VERSION, "The local image-processing runtime could not be loaded.")
      }
      status("ready", profile.id, profile.version, MODEL_BUNDLE_VERSION, "${if (profile.id == "fuel_v1") "Fuel" else "Generic"} receipt scanning is ready.")
    }

    AsyncFunction("recognize") Coroutine { options: RecognizeOptions ->
      val cancelled = AtomicBoolean(false)
      cancellations[options.requestId] = cancelled
      try {
        withContext(Dispatchers.Default) {
          if (cancelled.get()) throw CancelledException()
          val context = requireNotNull(appContext.reactContext)
          val profile = PROFILES[options.profile] ?: throw ModelsIncompatibleException()
          val activeEngine = synchronized(this@PaddleOcrModule) {
            engine ?: PaddleOcrEngine(context, ASSET_ROOT).also { engine = it }
          }
          activeEngine.recognize(options.imageUri, profile) { cancelled.get() }
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

  private fun status(state: String, profile: String, profileVersion: String?, version: String?, message: String) = mapOf(
    "state" to state,
    "engine" to "paddle_ocr",
    "profile" to profile,
    "profileVersion" to profileVersion,
    "modelBundleVersion" to version,
    "safeMessage" to message,
  )
}
