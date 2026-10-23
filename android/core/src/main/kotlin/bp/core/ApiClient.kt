package bp.core

import java.net.HttpURLConnection
import java.net.URI
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json

class ApiException(val status: Int) : Exception("HTTP $status")

/** The member side of the pathway API. Any non-2xx throws, which is what keeps the token in place. */
class ApiClient(
  private val base: String,
  /** Spike auth. The real client sends the session token from the Keystore. */
  private val member: String,
) : ChangeSink {
  private val json = Json { ignoreUnknownKeys = true }

  override suspend fun send(changes: Changes) {
    request("v1/health/changes", json.encodeToString(changes))
  }

  suspend fun enroll(entry: Entry): Pathway =
    json.decodeFromString(
      request("v1/bp-pathway/enroll", json.encodeToString(mapOf("entry" to entry)))
    )

  suspend fun pathway(): Pathway = json.decodeFromString(request("v1/bp-pathway"))

  suspend fun config(): Config = json.decodeFromString(request("v1/health/config"))

  private suspend fun request(path: String, body: String? = null): String =
    withContext(Dispatchers.IO) {
      val conn = URI.create(base.trimEnd('/') + "/" + path).toURL().openConnection() as HttpURLConnection
      try {
        conn.setRequestProperty("x-member-id", member)
        if (body != null) {
          conn.requestMethod = "POST"
          conn.doOutput = true
          conn.setRequestProperty("content-type", "application/json")
          conn.outputStream.use { it.write(body.toByteArray()) }
        }
        val status = conn.responseCode
        if (status !in 200..299) throw ApiException(status)
        conn.inputStream.bufferedReader().use { it.readText() }
      } finally {
        conn.disconnect()
      }
    }
}
