package com.madmeower.pawpower

import android.app.Application
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject

data class EquipmentPreferences(
    val revision: String, val delay: String, val tracerFaults: Boolean, val canFaults: Boolean,
    val controllerEnabled: Boolean, val controllerF: String, val batteryEnabled: Boolean, val batteryF: String
) {
    fun error(): String? {
        if(delay.toIntOrNull() !in 30..600) return "Confirmation delay must be 30–600 seconds."
        for(value in listOf(controllerF,batteryF)) {
            val n=value.toDoubleOrNull()
            if(n==null || !n.isFinite() || n !in -148.0..302.0) return "Temperature must be between -148 and 302 °F."
        }
        return null
    }
    fun json()=JSONObject().put("revision",revision).put("delay",delay.toInt())
        .put("tracer_faults",tracerFaults).put("can_faults",canFaults)
        .put("controller_high",JSONObject().put("enabled",controllerEnabled).put("threshold_c",(controllerF.toDouble()-32)/1.8))
        .put("battery_high",JSONObject().put("enabled",batteryEnabled).put("threshold_c",(batteryF.toDouble()-32)/1.8))
    companion object {
        fun parse(j: JSONObject): EquipmentPreferences {
            val c=j.getJSONObject("controller_high");val b=j.getJSONObject("battery_high")
            return EquipmentPreferences(j.getString("revision"),j.getInt("delay").toString(),
                j.getBoolean("tracer_faults"),j.getBoolean("can_faults"),
                c.getBoolean("enabled"),alertThresholdText("battery_temperature_c",c.getDouble("threshold_c")),
                b.getBoolean("enabled"),alertThresholdText("battery_temperature_c",b.getDouble("threshold_c")))
                .also {require(it.error()==null)}
        }
    }
}
class EquipmentPreferencesViewModel(application: Application): AndroidViewModel(application) {
    var draft by mutableStateOf<EquipmentPreferences?>(null);private set
    var busy by mutableStateOf(false);private set
    var message by mutableStateOf("Loading equipment alerts…");private set
    private var saved: EquipmentPreferences?=null
    val dirty get()=draft!=null && draft!=saved
    fun edit(p: EquipmentPreferences){if(!busy)draft=p}
    fun load()=request(null)
    fun save(){val p=draft?:return;p.error()?.let{message=it;return};request(p)}
    private fun request(update: EquipmentPreferences?) {
        if(busy)return
        busy=true
        viewModelScope.launch {
            try {
                val j=PawServer.json(getApplication(),"equipment-preferences.php",update?.json(),8192)
                saved=EquipmentPreferences.parse(j);draft=saved
                message=if(update==null)"Loaded equipment alerts" else "Saved. Changes may take up to one minute to apply and confirm."
            }catch(e: CancellationException){throw e}
            catch(e: Exception){message=e.message?:"Equipment alerts unavailable. Upload the new server files first."}
            finally{busy=false}
        }
    }
}
@Composable
fun EquipmentPreferencesCard(model: EquipmentPreferencesViewModel) {
    LaunchedEffect(model){if(model.draft==null)model.load()}
    var confirmReload by remember{mutableStateOf(false)}
    ElevatedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
            Text("Equipment alerts",style=MaterialTheme.typography.titleLarge)
            Text("Requires Notifications above to be On. Changes may take up to one minute to apply and confirm.",
                style=MaterialTheme.typography.bodySmall)
            val p=model.draft
            if(p!=null) {
                EquipmentSwitch("Tracer controller faults",p.tracerFaults,!model.busy){model.edit(p.copy(tracerFaults=it))}
                EquipmentSwitch("6000XP CAN communication errors",p.canFaults,!model.busy){model.edit(p.copy(canFaults=it))}
                Text("Internal 6000XP fault codes are not available through the current CAN connection.",
                    style=MaterialTheme.typography.bodySmall)
                EquipmentSwitch("High Tracer controller temperature",p.controllerEnabled,!model.busy){model.edit(p.copy(controllerEnabled=it))}
                OutlinedTextField(p.controllerF,{model.edit(p.copy(controllerF=it))},label={Text("Controller high temperature (°F)")},
                    singleLine=true,enabled=!model.busy,keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Decimal))
                EquipmentSwitch("High Tracer battery probe temperature",p.batteryEnabled,!model.busy){model.edit(p.copy(batteryEnabled=it))}
                OutlinedTextField(p.batteryF,{model.edit(p.copy(batteryF=it))},label={Text("Battery probe high temperature (°F)")},
                    singleLine=true,enabled=!model.busy,keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Decimal))
                OutlinedTextField(p.delay,{model.edit(p.copy(delay=it))},label={Text("Equipment confirmation delay (seconds)")},
                    singleLine=true,enabled=!model.busy,keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Number))
            }
            Text(model.message,style=MaterialTheme.typography.bodySmall)
            Button(onClick=model::save,enabled=p!=null&&model.dirty&&!model.busy){Text("Save equipment alerts")}
            TextButton(onClick={if(model.dirty)confirmReload=true else model.load()},enabled=!model.busy){Text("Reload equipment alerts")}
        }
    }
    if(confirmReload) AlertDialog(onDismissRequest={confirmReload=false},title={Text("Discard equipment alert edits?")},
        confirmButton={TextButton(onClick={confirmReload=false;model.load()}){Text("Reload")}},
        dismissButton={TextButton(onClick={confirmReload=false}){Text("Keep editing")}})
}
@Composable
private fun EquipmentSwitch(label: String, value: Boolean, enabled: Boolean, changed: (Boolean)->Unit) {
    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
        Text(label,Modifier.weight(1f));Switch(value,changed,enabled=enabled)
    }
}
