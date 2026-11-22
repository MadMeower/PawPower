package com.madmeower.pawpower

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import java.time.Instant
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale
import android.os.SystemClock
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun UnitLogsScreen(model: UnitLogsViewModel, modifier: Modifier=Modifier, onBack: ()->Unit) {
    LaunchedEffect(model){if(model.snapshot==null&&!model.busy)model.load()}
    var readings by rememberSaveable { mutableStateOf(false) }
    var metric by rememberSaveable { mutableIntStateOf(2) }
    var dayMenu by remember { mutableStateOf(false) }
    var metricMenu by remember { mutableStateOf(false) }
    val scope=rememberCoroutineScope()
    val save=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/csv"),model::saveExport)
    var now by remember { mutableLongStateOf(SystemClock.elapsedRealtime()) }
    val lifecycle=LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(lifecycle){lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED){while(true){now=SystemClock.elapsedRealtime();delay(1000)}}}
    val data=model.snapshot;val showReadings=readings&&model.device=="tracer"
    val timeFormat=remember { DateTimeFormatter.ofPattern("h:mm:ss a",Locale.US).withZone(unitLogZone) }
    LazyColumn(modifier.fillMaxSize().imePadding(),contentPadding=PaddingValues(20.dp),
        verticalArrangement=Arrangement.spacedBy(12.dp)) {
        item {
            Column(verticalArrangement=Arrangement.spacedBy(10.dp)){
                Text("Unit logs",style=MaterialTheme.typography.headlineLarge)
                TextButton(onClick=onBack){Text("Back to monitoring")}
                Row(horizontalArrangement=Arrangement.spacedBy(10.dp)){
                    FilterChip(model.device=="pawpower",{model.select("pawpower",model.date)},{Text("Shunt")})
                    FilterChip(model.device=="tracer",{model.select("tracer",model.date)},{Text("Tracer")})
                }
                Row(horizontalArrangement=Arrangement.spacedBy(10.dp)){
                    FilterChip(!showReadings,{readings=false},{Text("Errors / events")})
                    if(model.device=="tracer")FilterChip(showReadings,{readings=true},{Text("Daily readings")})
                }
                Box{
                    OutlinedButton(onClick={dayMenu=true}){Text(model.date)}
                    DropdownMenu(dayMenu,{dayMenu=false}){
                        unitLogDays().forEach { day -> DropdownMenuItem(text={Text(LocalDate.parse(day)
                            .format(DateTimeFormatter.ofPattern("EEE, MMM d",Locale.US)))},
                            onClick={dayMenu=false;model.select(model.device,day)})}
                    }
                }
                Row(horizontalArrangement=Arrangement.spacedBy(10.dp)){
                    Button(onClick=model::load,enabled=!model.busy){Text(if(model.busy)"Loading…" else "Refresh")}
                    OutlinedButton(onClick={scope.launch { model.prepareExport(showReadings)?.let { save.launch(it) } }},
                        enabled=data!=null&&!model.busy&&!model.exporting&&(if(showReadings)data.readingsAvailable else data.errorsAvailable)){Text(if(model.exporting)"Preparing…" else "Save CSV")}
                }
                if(model.message.isNotEmpty())Text(model.message,color=MaterialTheme.colorScheme.error)
                if(model.exportMessage.isNotEmpty())Text(model.exportMessage)
                if(data!=null){
                    val received=data.received
                    val age=received?.let { (data.serverTime+(now-data.fetchedElapsed).coerceAtLeast(0)/1000-it).coerceAtLeast(0) }
                    Text(if(received==null)"No unit logs synced yet. Update server and firmware, then enable Cloud Uploads."
                        else "Last known unit sync: "+timeFormat.format(Instant.ofEpochSecond(received))+" · $age s ago",
                        color=if(age!=null&&age>120)MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
                    if(data.clock==false)Text("Unit clock unavailable; new events cannot be dated.")
                    if(data.rollback)Text("Unit clock moved backwards; recording is paused.",color=MaterialTheme.colorScheme.error)
                    Text("Seven days · times America/Detroit · cloud copies of the unit’s local logs",
                        style=MaterialTheme.typography.bodySmall)
                    if(showReadings){
                        Text("${data.points.size} one-minute snapshots synced. First batch takes about five minutes. Older hours backfill gradually; gaps stay gaps.",
                            style=MaterialTheme.typography.bodySmall)
                        Box{
                            OutlinedButton(onClick={metricMenu=true}){Text(unitLogMetrics[metric].first)}
                            DropdownMenu(metricMenu,{metricMenu=false}){
                                unitLogMetrics.forEachIndexed { i,m -> DropdownMenuItem(text={Text(m.first)},
                                    onClick={metric=i;metricMenu=false}) }
                            }
                        }
                        if(!data.readingsAvailable)Text("No archived readings synced for this day yet.")
                    }else{
                        if(!data.errorsAvailable)Text("This day’s error log has not synced yet.")
                        else if(data.events.isEmpty())Text("No retained events for this day.")
                        if(data.omitted>0)Text("${data.omitted} older events omitted by the unit’s 32-entry daily limit.")
                    }
                }
            }
        }
        if(data!=null&&showReadings)items(data.points.asReversed(),key={it.time/60}) { point ->
            val value=unitLogValue(point,metric)
            ElevatedCard(Modifier.fillMaxWidth()){
                Column(Modifier.padding(14.dp),verticalArrangement=Arrangement.spacedBy(4.dp)){
                    Text(timeFormat.format(Instant.ofEpochSecond(point.time)),style=MaterialTheme.typography.labelLarge)
                    Text(value?.let { "%.2f %s".format(Locale.US,it,unitLogMetrics[metric].second) } ?: "— unavailable / stale",
                        color=if(value!=null&&value<0)MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface)
                    Text(when(point.values.count { it!=null }){7->"Fresh snapshot";0->"No fresh readings";else->"Partial snapshot"},
                        style=MaterialTheme.typography.bodySmall)
                }
            }
        }
        if(data!=null&&!showReadings)itemsIndexed(data.events.asReversed()) { _,event ->
            ElevatedCard(Modifier.fillMaxWidth()){
                Column(Modifier.padding(14.dp),verticalArrangement=Arrangement.spacedBy(4.dp)){
                    Text(timeFormat.format(Instant.ofEpochSecond(event.time)),style=MaterialTheme.typography.labelLarge)
                    Text(unitEventLabel(event.code,event.detail))
                }
            }
        }
    }
}
