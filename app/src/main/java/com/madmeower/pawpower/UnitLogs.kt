package com.madmeower.pawpower

import android.app.Application
import android.content.Context
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.compose.runtime.*
import kotlinx.coroutines.*
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.Locale

val unitLogZone: ZoneId = ZoneId.of("America/Detroit")
fun unitLogDays(now: Instant = Instant.now()): List<String> =
    (0L..6L).map { now.atZone(unitLogZone).toLocalDate().minusDays(it).toString() }
data class UnitLogEvent(val time: Long, val code: Int, val detail: Int)
data class UnitLogPoint(val time: Long, val values: List<Double?>)
data class UnitLogSnapshot(
    val device: String, val date: String, val serverTime: Long, val received: Long?,
    val clock: Boolean?, val rollback: Boolean, val errorsAvailable: Boolean,
    val readingsAvailable: Boolean, val omitted: Long,
    val events: List<UnitLogEvent>, val points: List<UnitLogPoint>, val fetchedElapsed: Long = 0
)
val unitLogMetrics = listOf("Panel voltage" to "V", "Panel amps" to "A", "Solar watts" to "W",
    "Battery voltage" to "V", "Battery amps" to "A", "Battery temperature" to "°F", "Controller temperature" to "°F")
fun unitLogValue(point: UnitLogPoint, index: Int): Double? =
    point.values.getOrNull(index)?.let { if (index >= 5) it * 1.8 + 32 else it }
fun validUnitLogPoint(point: UnitLogPoint): Boolean {
    val low = listOf(0.0, 0.0, 0.0, 0.0, -2000.0, -100.0, -100.0)
    val high = listOf(1500.0, 2000.0, 100000.0, 1000.0, 2000.0, 150.0, 150.0)
    return point.time > 0 && point.values.size == 7 &&
        point.values.indices.all { i -> point.values[i]?.let { it.isFinite() && it in low[i]..high[i] } ?: true }
}
fun unitEventLabel(code: Int, value: Int): String = when(code) {
    1 -> "Startup observed · " + (mapOf(1 to "power on",3 to "software restart",4 to "panic / abort",
        5 to "interrupt watchdog",6 to "task watchdog",7 to "watchdog",9 to "brownout")[value] ?: "reset reason $value")
    10 -> listOf("CAN communication recovered","CAN initialization failed","CAN status read failed",
        "CAN bus-off / recovery","CAN start failed","CAN transmit backlog","CAN transmit failed",
        "CAN transmission errors").getOrNull(value) ?: "CAN error $value"
    12 -> if(value == 0) "Shunt readings recovered" else "Shunt readings missing or stale"
    20 -> if(value == 0) "Controller fault flags cleared" else "Controller fault flags 0x%04X".format(Locale.US,value)
    22 -> if(value == 0) "Tracer readings recovered" else "Tracer readings missing or stale"
    24 -> "Modbus exceptions · $value since previous summary"
    26 -> when(value shr 8) {
        3 -> "Manual charging command acknowledged"
        4 -> "Manual charging command rejected · exception ${value and 255}"
        5 -> "Manual charging command timed out"
        6 -> "Manual charging command refused in Listen mode"
        7 -> "Manual charging command cancelled"
        else -> "Charging command result ${value shr 8}"
    }
    30 -> if(value == 0) "Wi-Fi reconnected" else "Wi-Fi disconnected"
    32 -> listOf("Cloud uploads recovered","Cloud upload connection failed","Cloud device token rejected",
        "Cloud upload rejected by server","Cloud uploader setup failed").getOrNull(value) ?: "Cloud upload error $value"
    33,34 -> (if(code == 33) "Alert checks" else "History uploads") +
        if(value == 0) " recovered" else " failed · " + (mapOf(2 to "server endpoint missing",3 to "device token rejected",4 to "network or server error")[value] ?: value)
    35 -> if(value == 0) "Local readings archive recovered" else "Local readings archive error · " +
        (mapOf(2 to "installed storage partition too small",3 to "storage could not open",4 to "saved data unreadable or corrupt",
            5 to "save failed or storage reserve reached",6 to "worker could not start",7 to "clock moved backwards")[value] ?: value)
    else -> "Event $code · $value"
}
fun unitLogCsv(snapshot: UnitLogSnapshot, readings: Boolean): String {
    fun quote(text: String) = "\"" + text.replace("\"", "\"\"") + "\""
    return if(readings) {
        "utc_time,solar_watts,panel_voltage,panel_amps,battery_voltage,battery_amps,battery_temp_f,controller_temp_f,quality\n" +
            snapshot.points.sortedBy { it.time }.joinToString("") { p ->
                val fields = listOf(2,0,1,3,4,5,6).map { i -> unitLogValue(p,i)?.let { "%.2f".format(Locale.US,it) } ?: "" }
                val fresh=p.values.count { it != null }
                Instant.ofEpochSecond(p.time).toString()+","+fields.joinToString(",")+","+
                    (if(fresh==7) "fresh" else if(fresh==0) "missing" else "partial")+"\n"
            }
    } else "utc_time,event,code,detail\n" + snapshot.events.sortedBy { it.time }.joinToString("") { e ->
        "${Instant.ofEpochSecond(e.time)},${quote(unitEventLabel(e.code,e.detail))},${e.code},${e.detail}\n"
    }
}
object UnitLogsData {
    suspend fun fetch(context: Context, device: String, date: String): UnitLogSnapshot = withContext(Dispatchers.IO) {
        require(device in listOf("pawpower","tracer"))
        LocalDate.parse(date)
        val j = PawServer.json(context,"device-logs.php?device=$device&date=$date",limit=524288)
        require(j.getString("device")==device && j.getString("date")==date)
        val rawEvents=j.getJSONArray("errors"); val rawPoints=j.getJSONArray("readings")
        require(rawEvents.length()<=32 && rawPoints.length()<=1560)
        val start=LocalDate.parse(date).atStartOfDay(unitLogZone).toEpochSecond()
        val end=LocalDate.parse(date).plusDays(1).atStartOfDay(unitLogZone).toEpochSecond()
        val events=(0 until rawEvents.length()).map { i ->
            val row=rawEvents.getJSONArray(i);require(row.length()==3)
            UnitLogEvent(row.getLong(0),row.getInt(1),row.getInt(2)).also {
                require(it.time in start until end && it.code in 0..65535 && it.detail in 0..65535)
            }
        }
        val points=(0 until rawPoints.length()).map { i ->
            val row=rawPoints.getJSONArray(i);require(row.length()==8)
            UnitLogPoint(row.getLong(0),(1..7).map { k -> if(row.isNull(k)) null else row.getDouble(k) }).also {
                require(validUnitLogPoint(it) && it.time in start until end)
            }
        }.sortedBy { it.time }
        require(points.map { it.time/60 }.distinct().size==points.size)
        return@withContext UnitLogSnapshot(device,date,j.getLong("server_time"),if(j.isNull("received_at"))null else j.getLong("received_at"),
            if(j.isNull("clock"))null else j.getBoolean("clock"),j.getBoolean("rollback"),
            j.getBoolean("errors_available"),j.getBoolean("readings_available"),j.getLong("omitted").also { require(it>=0) },
            events,points,android.os.SystemClock.elapsedRealtime())
    }
}
class UnitLogsViewModel(application: Application): AndroidViewModel(application) {
    var device by mutableStateOf("pawpower"); private set
    var date by mutableStateOf(unitLogDays().first()); private set
    var snapshot by mutableStateOf<UnitLogSnapshot?>(null); private set
    var busy by mutableStateOf(false); private set
    var message by mutableStateOf(""); private set
    var exportMessage by mutableStateOf(""); private set
    var exporting by mutableStateOf(false); private set
    private var pendingCsv: String? = null
    private var request: Job? = null
    private var revision=0
    fun select(unit: String, day: String) {
        if(device==unit && date==day && (snapshot!=null||busy)) return
        device=unit;date=day;snapshot=null;exportMessage="";load()
    }
    fun load() {
        request?.cancel();val id=++revision;val unit=device;val day=date
        busy=true;message="Loading unit logs…"
        request=viewModelScope.launch {
            try {val result=UnitLogsData.fetch(getApplication(),unit,day);if(id==revision){snapshot=result;message=""}}
            catch(e: CancellationException){throw e}
            catch(e: MonitoringException){if(id==revision)message=e.message?:"Logs unavailable."}
            catch(_: Exception){if(id==revision)message="Could not read unit logs. Check connection and updated server files."}
            finally{if(id==revision)busy=false}
        }
    }
    suspend fun prepareExport(readings: Boolean): String? {
        val data=snapshot?:return null
        if(exporting)return null
        exporting=true;exportMessage=""
        return try {
            pendingCsv=withContext(Dispatchers.Default){unitLogCsv(data,readings)}
            "PawPower-${if(data.device=="tracer")"Tracer" else "Shunt"}-${if(readings)"Readings" else "Errors"}-${data.date}.csv"
        } finally {exporting=false}
    }
    fun saveExport(uri: Uri?) {
        val csv=pendingCsv;pendingCsv=null;if(uri==null)return
        if(csv==null){exportMessage="Export was interrupted. Please open the day and save again.";return}
        viewModelScope.launch {
            try {withContext(Dispatchers.IO) {
                val stream=getApplication<Application>().contentResolver.openOutputStream(uri,"wt")
                    ?: throw java.io.IOException("Could not open file")
                stream.bufferedWriter(Charsets.UTF_8).use { it.write(csv) }
            };exportMessage="CSV saved."}
            catch(e: CancellationException){throw e}
            catch(_: Exception){exportMessage="Could not save CSV. Please try again."}
        }
    }
}
