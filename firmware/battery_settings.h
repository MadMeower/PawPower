#pragma once
#include "esphome/core/preferences.h"
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

namespace paw {
enum SettingIndex { CAPACITY, STOP_SOC, RESUME_SOC, CHARGE_V, HOLD_V,
  CHARGE_A, DISCHARGE_A, CUTOFF_V, RECOVERY_V, WARNING_V, COLD_ENABLED, COLD_STOP_C, COLD_RESUME_C, HOT_ENABLED, HOT_STOP_C, HOT_RESUME_C, SETTING_COUNT };
struct BatterySettings {
  std::array<float, SETTING_COUNT> v{{1120,95,93,56.8f,54,125,140,48,50.8f,49,1,2,5,1,45,40}};
};
inline const char *validate_settings(const BatterySettings &s) {
  const auto &v=s.v;
  const float lo[]={1,50,0,48,40,1,1,40,40,40,0};
  const float hi[]={10000,100,99,60,60,600,600,56,60,60,1};
  for(unsigned i=0;i<SETTING_COUNT;++i)
    if(!std::isfinite(v[i]) || (i<COLD_STOP_C && (v[i]<lo[i] || v[i]>hi[i])))return "Value outside supported range";
  for(unsigned i=0;i<COLD_STOP_C;++i)
    if(std::fabs(v[i]*10-std::round(v[i]*10))>0.001f)return "Use at most one decimal place";
  if(v[RESUME_SOC]>v[STOP_SOC]-1)return "Resume SOC must be at least 1% below stop SOC";
  if(v[CUTOFF_V]>=v[HOLD_V] || v[HOLD_V]>v[CHARGE_V])return "Require cutoff < hold voltage <= charge voltage";
  if(v[RECOVERY_V]<v[CUTOFF_V]+0.5f || v[RECOVERY_V]>=v[CHARGE_V])return "Recovery must be >= cutoff + 0.5 V and below charge voltage";
  if(v[WARNING_V]<v[CUTOFF_V] || v[WARNING_V]>v[RECOVERY_V])return "Warning voltage must be between cutoff and recovery";
  if(v[COLD_ENABLED]!=0 && v[COLD_ENABLED]!=1)return "Cold protection must be enabled or disabled";
  if(v[COLD_RESUME_C]<=v[COLD_STOP_C])return "Cold resume must be higher than stop";
  if(v[HOT_ENABLED]!=0 && v[HOT_ENABLED]!=1)return "Hot protection must be enabled or disabled";
  if(v[HOT_RESUME_C]>=v[HOT_STOP_C])return "Hot resume must be lower than stop";
  return nullptr;
}
struct SettingsRecord {
  uint32_t magic=0x50415734,version=3,revision=0;
  BatterySettings settings{};
  uint32_t checksum=0;
};
static_assert(sizeof(SettingsRecord)==80,"Settings storage format changed");
template<size_t N> struct LegacyRecord {
  uint32_t magic,version,revision;
  std::array<float,N> values;
  uint32_t checksum;
};
using LegacySettingsRecord=LegacyRecord<10>;
using ColdSettingsRecord=LegacyRecord<13>;
static_assert(sizeof(LegacySettingsRecord)==56,"Legacy storage format changed");
static_assert(sizeof(ColdSettingsRecord)==68,"Cold storage format changed");
template<class T> inline uint32_t settings_checksum(const T &r) {
  uint32_t hash=2166136261U;
  const auto *p=reinterpret_cast<const uint8_t *>(&r);
  for(size_t i=0;i<sizeof(r)-sizeof(r.checksum);++i){hash^=p[i];hash*=16777619U;}
  return hash;
}
class SettingsStore {
 public:
  void setup() {
    ready_=esphome::global_preferences!=nullptr;
    if(!ready_){message_="Settings storage unavailable";return;}
    preference_=esphome::global_preferences->make_preference<SettingsRecord>(0x50415734U,true);
    SettingsRecord loaded;
    if(preference_.load(&loaded)) {
      if(loaded.magic==record_.magic && loaded.version==3 &&
         loaded.checksum==settings_checksum(loaded) && !validate_settings(loaded.settings)) {
        record_=loaded;message_="Settings restored from flash";saved_=true;
      } else message_="Invalid stored profile; review starting values and Apply";
      return;
    }
    auto cold_pref=esphome::global_preferences->make_preference<ColdSettingsRecord>(0x50415733U,true);
    ColdSettingsRecord cold{};
    if(cold_pref.load(&cold)) {
      if(cold.magic==0x50415733U && cold.version==2 &&
         cold.checksum==settings_checksum(cold) && migrate(cold))return;
      message_="Invalid previous profile; review starting values and Apply";
      return;
    }
    auto legacy_pref=esphome::global_preferences->make_preference<LegacySettingsRecord>(0x50415732U,true);
    LegacySettingsRecord legacy{};
    if(legacy_pref.load(&legacy) && legacy.magic==0x50415732U && legacy.version==1 &&
       legacy.checksum==settings_checksum(legacy) && migrate(legacy))return;
    message_="Using starting values; review and Apply for this bank";
  }
  const BatterySettings &get()const{return record_.settings;}
  bool confirmed()const{return saved_;}
  uint32_t revision()const{return record_.revision;}
  bool apply(const std::string &payload) {
    // One revision-tagged request is validated and committed as one NVS record.
    // Never let independent field writes expose a half-edited control profile.
    if(!ready_)return fail("Settings storage unavailable");
    const size_t divider=payload.find('|');
    if(divider==std::string::npos || divider==0 || divider>10)return fail("Invalid settings request");
    const auto rev=payload.substr(0,divider);
    if(rev.find_first_not_of("0123456789")!=std::string::npos)return fail("Invalid settings revision");
    char *end=nullptr;
    const unsigned long long expected=std::strtoull(rev.c_str(),&end,10);
    if(*end || expected!=record_.revision)return fail("Settings changed elsewhere; reload saved values before applying");
    SettingsRecord next=record_;
    size_t start=divider+1;
    for(unsigned i=0;i<SETTING_COUNT;++i){
      const size_t comma=payload.find(',',start);
      if((i<SETTING_COUNT-1 && comma==std::string::npos) ||
         (i==SETTING_COUNT-1 && comma!=std::string::npos))return fail("Expected all sixteen settings together");
      const std::string token=payload.substr(start,comma==std::string::npos?comma:comma-start);
      if(token.empty() || token.size()>16 || token.find_first_not_of("0123456789.-")!=std::string::npos)
        return fail("Settings must be decimal numbers");
      next.settings.v[i]=std::strtof(token.c_str(),&end);
      if(*end)return fail("Invalid decimal number");
      start=comma==std::string::npos?payload.size():comma+1;
    }
    if(const char *error=validate_settings(next.settings))return fail(error);
    if(saved_ && next.settings.v==record_.settings.v){message_="Already saved; no flash write needed";return true;}
    if(record_.revision==UINT32_MAX)return fail("Settings revision exhausted");
    ++next.revision;next.checksum=settings_checksum(next);
    if(!preference_.save(&next) || !esphome::global_preferences->sync()){
      // Replace a possible pending write with the previous record.
      auto previous=record_;if(!saved_)previous.magic=0;previous.checksum=settings_checksum(previous);
      preference_.save(&previous);esphome::global_preferences->sync();
      return fail("Flash save failed; settings were not activated");
    }
    record_=next;saved_=true;message_="Saved to flash; waiting for fresh shunt readings";return true;
  }
  std::string json()const {
    char b[768];const auto &v=get().v;
    std::snprintf(b,sizeof(b),"{\"revision\":%lu,\"saved\":%s,\"values\":[%.3f,%.3f,%.3f,%.3f,%.3f,%.3f,%.3f,%.3f,%.3f,%.3f,%.3f,%.3f,%.3f,%.3f,%.3f,%.3f],\"message\":\"%s\"}",
      static_cast<unsigned long>(revision()),saved_?"true":"false",v[0],v[1],v[2],v[3],v[4],v[5],v[6],v[7],v[8],v[9],v[10],v[11],v[12],v[13],v[14],v[15],message_.c_str());
    return b;
  }
 private:
  template<size_t N> bool migrate(const LegacyRecord<N> &legacy) {
    BatterySettings migrated;
    for(size_t i=0;i<N;++i)migrated.v[i]=legacy.values[i];
    if(validate_settings(migrated))return false;
    record_.settings=migrated;record_.revision=legacy.revision;
    message_="Previous values retained; review high-temperature protection and Apply to resume CAN";
    return true;
  }
  bool fail(const char *message){message_=message;return false;}
  SettingsRecord record_{};
  esphome::ESPPreferenceObject preference_{};
  bool ready_=false,saved_=false;
  std::string message_="Settings starting";
};
inline SettingsStore &settings_store(){static SettingsStore s;return s;}
} // namespace paw
