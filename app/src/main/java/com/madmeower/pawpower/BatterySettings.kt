package com.madmeower.pawpower

import android.app.Application
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import java.net.URL
import javax.net.ssl.HttpsURLConnection
import java.math.BigDecimal
import java.math.RoundingMode

data class BatterySettingField(val label: String, val unit: String)
val batterySettingFields = listOf(
    BatterySettingField("Bank capacity", "Ah"), BatterySettingField("Charge stop SOC", "%"),
    BatterySettingField("Charge resume SOC", "%"), BatterySettingField("Charge voltage", "V"),
    BatterySettingField("Hold voltage", "V"), BatterySettingField("Charge amps limit", "A"),
    BatterySettingField("Discharge amps limit", "A"), BatterySettingField("Discharge cutoff", "V"),
    BatterySettingField("Discharge recovery", "V"), BatterySettingField("Low voltage warning", "V"),
    BatterySettingField("Cold charge protection", ""), BatterySettingField("Cold stop", "°F"),
    BatterySettingField("Cold resume", "°F"), BatterySettingField("Hot charge protection", ""),
    BatterySettingField("Hot stop", "°F"), BatterySettingField("Hot resume", "°F"),
    BatterySettingField("Discharge stop SOC", "%"), BatterySettingField("Discharge resume SOC", "%")
)
private val batteryTempFields = setOf(11, 12, 14, 15)
fun batterySettingText(index: Int, value: Double): String = BigDecimal.valueOf(
    if (index in batteryTempFields) value * 1.8 + 32 else value
).setScale(if (index in batteryTempFields) 1 else 3, RoundingMode.HALF_UP).stripTrailingZeros().toPlainString()
fun batterySettingWire(index: Int, text: String): Double? = text.toDoubleOrNull()?.takeIf { it.isFinite() }?.let {
    if (index in batteryTempFields) (it - 32) / 1.8 else it
}
fun batterySettingsError(v: List<Double>): String? {
    val lo = listOf(1.0,50.0,0.0,48.0,40.0,1.0,1.0,40.0,40.0,40.0,0.0,-100.0,-100.0,0.0,-100.0,-100.0,0.0,0.0)
    val hi = listOf(10000.0,100.0,99.0,60.0,60.0,600.0,600.0,56.0,60.0,60.0,1.0,150.0,150.0,1.0,150.0,150.0,100.0,100.0)
    if(v.size != 18) return "All battery settings are required."
    v.forEachIndexed { i,n ->
        if(!n.isFinite() || n < lo[i] || n > hi[i]) return "Check the range for ${batterySettingFields[i].label}."
        if(i !in batteryTempFields && kotlin.math.abs(n*10-kotlin.math.round(n*10)) > 0.001)
            return "Use at most one decimal place for ${batterySettingFields[i].label}."
    }
    if(v[10] !in listOf(0.0,1.0) || v[13] !in listOf(0.0,1.0)) return "Invalid protection switch."
    if(v[2]>v[1]-1 || v[17]<v[16]+1) return "SOC stop/resume levels need at least 1% separation."
    if(v[7]>=v[4] || v[4]>v[3] || v[8]<v[7]+0.5 || v[8]>=v[3] || v[9]<v[7] || v[9]>v[8])
        return "Check cutoff, recovery, warning, hold and charge voltage order."
    if(v[12]<=v[11] || v[15]>=v[14]) return "Check cold and hot stop/resume temperature order."
    return null
}

class BatterySettingsViewModel(application: Application): AndroidViewModel(application) {
    var draft by mutableStateOf<List<String>>(emptyList()); private set
    var busy by mutableStateOf(false); private set
    var message by mutableStateOf("Loading shunt settings…"); private set
    var dirty by mutableStateOf(false); private set
    var pending by mutableStateOf(false); private set
    var online by mutableStateOf(false); private set
    private var device: JSONObject? = null
    private var savedDraft: List<String> = emptyList()
    fun edit(index: Int, value: String) {
        if(busy || pending) return
        draft=draft.toMutableList().also { it[index]=value };dirty=draft!=savedDraft
    }
    fun load()=request(null)
    fun loadDiscardingDraft()=request(null,true)
    fun poll() { if(!dirty) request(null) }
    fun save() {
        val values=draft.mapIndexed { i,s -> batterySettingWire(i,s) }
        if(values.any { it==null }) {message="Enter a number in every field.";return}
        val v=values.filterNotNull()
        batterySettingsError(v)?.let {message=it;return}
        val current=device ?: return
        request(JSONObject().put("boot",current.getString("boot")).put("revision",current.getLong("revision"))
            .put("values",JSONArray(v)))
    }
    private fun request(update: JSONObject?, discard: Boolean=false) {
        if(busy) return
        busy=true
        viewModelScope.launch {
            try {
                val reply=withContext(Dispatchers.IO) {
                    val credentials=PhoneCredentials.read(getApplication())
                        ?: throw MonitoringException("Connect this phone in notification connection setup first.")
                    val c=URL("https://your-server.example/battery-settings.php").openConnection() as HttpsURLConnection
                    try {
                        c.requestMethod=if(update==null) "GET" else "POST";c.instanceFollowRedirects=false
                        c.connectTimeout=10000;c.readTimeout=15000
                        c.setRequestProperty("Authorization","Bearer "+credentials.appToken)
                        c.setRequestProperty("Accept","application/json")
                        if(update!=null) {c.doOutput=true;c.setRequestProperty("Content-Type","application/json")
                            c.outputStream.use {it.write(update.toString().toByteArray(Charsets.UTF_8))}}
                        when(c.responseCode) {
                            200 -> Unit
                            401 -> throw MonitoringException("Saved app token rejected.")
                            404 -> throw MonitoringException("Upload the new battery-settings server files first.")
                            409 -> throw MonitoringException("Shunt is offline, settings changed, or a request is pending. Reload before saving.")
                            400 -> throw MonitoringException("Server rejected these battery settings.")
                            else -> throw MonitoringException("Battery settings service unavailable.")
                        }
                        val bytes=c.inputStream.use { input ->
                            val out=java.io.ByteArrayOutputStream();val buffer=ByteArray(1024)
                            while(out.size()<8193) {val n=input.read(buffer,0,minOf(buffer.size,8193-out.size()));if(n<0)break;out.write(buffer,0,n)}
                            out.toByteArray()
                        }
                        if(bytes.size>8192) throw MonitoringException("Unexpected settings response.")
                        JSONObject(String(bytes,Charsets.UTF_8))
                    } finally {c.disconnect()}
                }
                val current=reply.optJSONObject("device")
                pending=reply.optJSONObject("pending")!=null
                online=current!=null && reply.getLong("server_time")-current.getLong("received_at")<=90
                if(current!=null) {
                    val array=current.getJSONArray("values")
                    val values=(0 until array.length()).map {array.getDouble(it)}
                    require(batterySettingsError(values)==null)
                    device=current
                    savedDraft=values.mapIndexed(::batterySettingText)
                    if(!dirty || update!=null || discard) {draft=savedDraft;dirty=false}
                }
                message=reply.optString("result","Waiting for the shunt to report its settings.")
                if(!online) message+=" · Shunt offline or cloud uploads off"
            } catch(e: CancellationException) {throw e}
            catch(e: Exception) {message=if(e is MonitoringException) e.message.orEmpty() else "Could not read battery settings. Your draft is kept.";online=false}
            finally {busy=false}
        }
    }
}

@Composable
fun BatterySettingsScreen(model: BatterySettingsViewModel, modifier: Modifier=Modifier, onBack: () -> Unit) {
    LaunchedEffect(model) {if(model.draft.isEmpty()) model.load()}
    val lifecycle=androidx.lifecycle.compose.LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(lifecycle,model) {
        lifecycle.repeatOnLifecycle(androidx.lifecycle.Lifecycle.State.STARTED) {
            while(true) {delay(10000);model.poll()}
        }
    }
    var reload by remember {mutableStateOf(false)}
    var confirm by remember {mutableStateOf(false)}
    Column(modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement=Arrangement.spacedBy(12.dp)) {
        Text("Shunt battery settings",style=MaterialTheme.typography.headlineLarge)
        TextButton(onClick=onBack){Text("Back to monitoring")}
        Text("These settings control PawPower’s CAN requests to the inverter.",style=MaterialTheme.typography.bodyMedium)
        Text("Changes may take up to one minute to apply and confirm.",style=MaterialTheme.typography.bodySmall)
        model.draft.forEachIndexed {i,value ->
            val field=batterySettingFields[i]
            if(i==10 || i==13) Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween) {
                Text(field.label);Switch(value=="1",{model.edit(i,if(it)"1" else "0")},enabled=!model.busy&&!model.pending)
            } else OutlinedTextField(value,{model.edit(i,it)},label={Text("${field.label} (${field.unit})")},
                singleLine=true,enabled=!model.busy&&!model.pending,modifier=Modifier.fillMaxWidth(),
                keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Decimal))
        }
        Text(model.message)
        Button(onClick={confirm=true},enabled=model.online&&model.dirty&&!model.busy&&!model.pending) {Text("Review & send to shunt")}
        TextButton(onClick={if(model.dirty) reload=true else model.load()},enabled=!model.busy){Text("Reload settings")}
    }
    if(reload) AlertDialog(onDismissRequest={reload=false},title={Text("Discard unsaved changes?")},
        confirmButton={TextButton(onClick={reload=false;model.loadDiscardingDraft()}){Text("Reload")}},
        dismissButton={TextButton(onClick={reload=false}){Text("Keep editing")}})
    if(confirm) AlertDialog(onDismissRequest={confirm=false},title={Text("Apply battery settings?")},
        text={Column {model.draft.forEachIndexed {i,value -> Text("${batterySettingFields[i].label}: $value ${batterySettingFields[i].unit}")}}},
        confirmButton={TextButton(onClick={confirm=false;model.save()}){Text("Send")}},
        dismissButton={TextButton(onClick={confirm=false}){Text("Cancel")}})
}
