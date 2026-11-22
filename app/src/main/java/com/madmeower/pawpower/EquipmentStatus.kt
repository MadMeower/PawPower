package com.madmeower.pawpower

import org.json.JSONObject

data class EquipmentStatus(val ageSeconds: Long, val known: Boolean, val active: List<String>)
fun equipmentStatusStale(status: EquipmentStatus, elapsedMs: Long): Boolean =
    readingAgeSeconds(status.ageSeconds,elapsedMs)>=90
fun parseEquipmentStatus(json: JSONObject?): Map<String,EquipmentStatus> {
    if(json==null)return emptyMap()
    return listOf("pawpower","tracer").mapNotNull {id ->
        val row=json.optJSONObject(id)?:return@mapNotNull null
        val age=(row.opt("age_seconds") as? Number)?.toLong()?.takeIf{it>=0}?:return@mapNotNull null
        val values=row.optJSONObject("values")
        val known=(values?.opt(if(id=="pawpower")"can_fault" else "tracer_status") as? Number)!=null
        val array=row.optJSONArray("active")
        val active=(0 until minOf(array?.length()?:0,4)).mapNotNull {i ->
            (array?.opt(i) as? String)?.takeIf{it.length<=512}
        }
        id to EquipmentStatus(age,known,active)
    }.toMap()
}
