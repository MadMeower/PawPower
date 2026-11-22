#pragma once
#include <array>
#include <cmath>
#include <cstdint>
#include <cstddef>
#include <cstdio>
#include <ctime>
#include <cstring>
#include <string>
namespace pawtracer {
struct ArchivedReading {
  uint32_t epoch=0;
  // PV voltage/amps/watts, battery voltage/amps, battery/controller Celsius.
  std::array<float,7> values{};
};
struct ArchivedHour {
  uint32_t magic=0x50545231,hour=0;
  std::array<ArchivedReading,60> rows{};
  uint32_t checksum=0;
};
static_assert(sizeof(ArchivedReading)==32,"Stable minute archive layout");
static_assert(sizeof(ArchivedHour)==1932,"Bounded hourly NVS blob");
inline uint32_t archive_checksum(const ArchivedHour &hour) {
  uint32_t hash=2166136261U;const auto *p=reinterpret_cast<const uint8_t *>(&hour);
  for(size_t i=0;i<offsetof(ArchivedHour,checksum);++i){hash^=p[i];hash*=16777619U;}return hash;
}
inline bool archive_valid(const ArchivedHour &hour,uint32_t key) {
  if(hour.magic!=0x50545231 || hour.hour!=key || hour.checksum!=archive_checksum(hour))return false;
  for(unsigned i=0;i<60;++i)if(hour.rows[i].epoch &&
    (hour.rows[i].epoch/3600!=key || hour.rows[i].epoch/60%60!=i))return false;
  return true;
}
inline bool archive_insert(ArchivedHour &hour,const ArchivedReading &reading) {
  if(!reading.epoch || reading.epoch/3600!=hour.hour)return false;
  auto &row=hour.rows[reading.epoch/60%60];
  if(row.epoch)return false; // Never overwrite an already observed minute after NTP/reboot.
  row=reading;hour.checksum=archive_checksum(hour);return true;
}
inline ArchivedReading archive_sample(uint32_t epoch,const std::array<float,7> &values,const std::array<float,7> &ages,float limit) {
  ArchivedReading row;row.epoch=epoch;row.values.fill(NAN);
  const float low[]={0,0,0,0,-2000,-100,-100},high[]={1500,2000,100000,1000,2000,150,150};
  for(unsigned i=0;i<7;++i)if(std::isfinite(ages[i]) && ages[i]>=0 && ages[i]<=limit &&
    std::isfinite(values[i]) && values[i]>=low[i] && values[i]<=high[i])row.values[i]=values[i];
  return row;
}
inline std::string archive_number(float value,bool fahrenheit=false) {
  if(!std::isfinite(value))return "";
  char out[32];std::snprintf(out,sizeof(out),"%.2f",fahrenheit?value*1.8f+32:value);return out;
}
inline std::string archive_csv_row(const ArchivedReading &row) {
  const time_t epoch=row.epoch;tm utc{};gmtime_r(&epoch,&utc);char when[32];
  std::strftime(when,sizeof(when),"%Y-%m-%dT%H:%M:%SZ",&utc);
  std::string out=when;
  // Match human-facing CSV column order.
  for(unsigned i : {2U,0U,1U,3U,4U,5U,6U})out+=","+archive_number(row.values[i],i>=5);
  unsigned fresh=0;for(float value:row.values)if(std::isfinite(value))++fresh;
  return out+","+(fresh==7?"fresh":fresh?"partial":"missing")+"\n";
}
inline constexpr char ARCHIVE_CSV_HEADER[]="utc_time,solar_watts,panel_voltage,panel_amps,battery_voltage,battery_amps,battery_temp_f,controller_temp_f,quality\n";
}
