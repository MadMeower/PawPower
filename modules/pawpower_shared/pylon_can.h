#pragma once
#include "battery_settings.h"
#include <array>
#include <cmath>
#include <cstdint>

// Pylontech low-voltage CAN, legacy standard frames, 500 kbit/s.
// Individual battery BMS protections are not available to this bridge.
namespace paw {
struct CanFrame {
  uint32_t id;
  uint8_t length;
  std::array<uint8_t, 8> bytes{};
};
inline void can_word(CanFrame &frame, unsigned offset, int value) {
  const uint16_t word = static_cast<uint16_t>(value);
  frame.bytes[offset] = word & 0xff;
  frame.bytes[offset + 1] = word >> 8;
}
inline bool can_sample_valid(bool received, uint32_t age_ms, float volts,
                             float amps, float soc, float temperature) {
  return received && age_ms < 15000 && std::isfinite(volts) &&
    std::isfinite(amps) && std::isfinite(soc) && std::isfinite(temperature) &&
    volts >= 40 && volts <= 65 && std::fabs(amps) <= 600 &&
    soc >= 0 && soc <= 100 && temperature >= -40 && temperature <= 100;
}
struct PylonPlan {
  float charge_voltage=56.8f, charge_amps=125.0f, discharge_amps=140.0f;
  float discharge_voltage=48.0f, capacity_ah=1120.0f;
  bool charge_allowed=true, discharge_allowed=true, soc_hold=false, cold_hold=false, hot_hold=false;
  bool finish_charge=false;
  uint8_t protection=0,warning=0;
};
class PylonControl {
 public:
  void accept(uint32_t ms,float volts,float amps,float soc,float temperature) {
    if(!can_sample_valid(true,0,volts,amps,soc,temperature)) {reject();return;}
    const uint32_t gap=ms-last_good_;
    if(!have_good_ || gap>=15000){good_count_=0;cold_hold_=true;hot_hold_=true;}
    // Do not count duplicate responses from another poller as recovery samples.
    if(!have_good_ || gap>=1000) {if(good_count_<3)++good_count_;}
    last_good_=ms;have_good_=true;
    volts_=volts;amps_=amps;soc_=soc;temperature_=temperature;
    const auto &v=settings_store().get().v;
    if(v[COLD_ENABLED]==0)cold_hold_=false;
    else if(temperature<=v[COLD_STOP_C])cold_hold_=true;
    else if(temperature>=v[COLD_RESUME_C])cold_hold_=false;
    if(v[HOT_ENABLED]==0)hot_hold_=false;
    else if(temperature>=v[HOT_STOP_C])hot_hold_=true;
    else if(temperature<=v[HOT_RESUME_C])hot_hold_=false;
    if(soc>=v[STOP_SOC])soc_hold_=true;
    else if(soc<=v[RESUME_SOC])soc_hold_=false;
    if(soc<=v[DISCHARGE_STOP_SOC])discharge_soc_hold_=true;
    else if(soc>=v[DISCHARGE_RESUME_SOC])discharge_soc_hold_=false;
    if(volts<=v[CUTOFF_V])low_voltage_hold_=true;
    else if(volts>=v[RECOVERY_V])low_voltage_hold_=false;
    if(finish_active_ && (cold_hold_ || hot_hold_))cancel_finish("Cancelled: temperature protection");
  }
  bool start_finish(uint32_t ms,bool output_enabled) {
    ++finish_sequence_;
    if(finish_active_){finish_message_="Already active; original one-hour deadline unchanged";return false;}
    if(!output_enabled){finish_message_="Enable CAN output first";return false;}
    if(!settings_store().confirmed()){finish_message_="Review and Apply battery settings first";return false;}
    if(!ready(ms)){finish_message_="Three fresh shunt replies required";return false;}
    const auto p=plan();
    if(p.cold_hold || p.hot_hold){finish_message_="Temperature protection prevents finish charge";return false;}
    finish_started_=ms;finish_active_=true;finish_message_="SOC cutoff override active";
    return true;
  }
  void cancel_finish(const char *reason="Cancelled; normal SOC cutoff restored") {
    if(!finish_active_)return;
    finish_active_=false;finish_message_=reason;++finish_sequence_;
  }
  void service_finish(uint32_t ms,bool output_enabled) {
    if(!finish_active_)return;
    if(uint32_t(ms-finish_started_)>=3600000U)cancel_finish("Expired; normal SOC cutoff restored");
    else if(!output_enabled)cancel_finish("Cancelled: CAN output disabled");
    else if(!settings_store().confirmed())cancel_finish("Cancelled: settings not confirmed");
    else if(!ready(ms))cancel_finish("Cancelled: shunt data unavailable or stale");
  }
  uint32_t finish_seconds(uint32_t ms)const {
    if(!finish_active_)return 0;
    const uint32_t elapsed=ms-finish_started_;
    return elapsed>=3600000U?0:(3600000U-elapsed+999)/1000;
  }
  std::string finish_status(uint32_t ms)const {
    const auto seconds=finish_seconds(ms);
    return seconds?("Finish charge: "+std::to_string(seconds/60)+"m "+std::to_string(seconds%60)+
      "s remaining | SOC override"):finish_message_;
  }
  std::string finish_json(uint32_t ms)const {
    const auto seconds=finish_seconds(ms);
    return std::string("{\"sequence\":")+std::to_string(finish_sequence_)+
      ",\"active\":"+(seconds?"true":"false")+
      ",\"remaining_seconds\":"+std::to_string(seconds)+
      ",\"message\":\""+finish_status(ms)+"\"}";
  }
  void reject(){cancel_finish("Cancelled: invalid shunt reading");good_count_=0;cold_hold_=true;hot_hold_=true;}
  void settings_changed(){cancel_finish("Cancelled: battery settings changed");good_count_=0;soc_hold_=false;low_voltage_hold_=false;discharge_soc_hold_=true;cold_hold_=true;hot_hold_=true;}
  bool ready(uint32_t ms) {
    if(!have_good_ || uint32_t(ms-last_good_)>=15000)good_count_=0;
    return good_count_>=3;
  }
  PylonPlan plan()const {
    PylonPlan p;
    const auto &v=settings_store().get().v;
    p.charge_voltage=v[CHARGE_V];p.charge_amps=v[CHARGE_A];
    p.discharge_amps=v[DISCHARGE_A];p.discharge_voltage=v[CUTOFF_V];
    p.capacity_ah=v[CAPACITY];
    p.finish_charge=finish_active_;
    p.soc_hold=soc_hold_ && !finish_active_;
    p.cold_hold=v[COLD_ENABLED]!=0 && cold_hold_;
    p.hot_hold=v[HOT_ENABLED]!=0 && hot_hold_;
    if(p.soc_hold || p.cold_hold || p.hot_hold){p.charge_voltage=v[HOLD_V];p.charge_amps=0;p.charge_allowed=false;}
    if(discharge_soc_hold_){p.discharge_amps=0;p.discharge_allowed=false;}
    if(low_voltage_hold_){p.discharge_amps=0;p.discharge_allowed=false;p.protection|=0x04;}
    if(volts_<=v[WARNING_V])p.warning|=0x04;
    return p;
  }
  float volts()const{return volts_;} float amps()const{return amps_;}
  float soc()const{return soc_;} float temperature()const{return temperature_;}
 private:
  bool finish_active_=false;
  uint32_t finish_started_=0,finish_sequence_=0;
  std::string finish_message_="Finish charge: Inactive";
  uint32_t last_good_=0;
  uint8_t good_count_=0;
  bool have_good_=false,soc_hold_=false,low_voltage_hold_=false,discharge_soc_hold_=true,cold_hold_=true,hot_hold_=true;
  float volts_=0,amps_=0,soc_=0,temperature_=0;
};
inline PylonControl &pylon_control(){static PylonControl c;return c;}
inline std::array<CanFrame, 7> pylon_frames(float volts, float amps, float soc,
                                          float temperature,const PylonPlan &plan=PylonPlan{}) {
  std::array<CanFrame, 7> frames{{{0x351,8,{}}, {0x355,4,{}}, {0x356,6,{}},
                                {0x359,7,{}}, {0x35c,2,{}}, {0x35e,8,{}}, {0x379,4,{}}}};
  can_word(frames[0], 0, std::lround(plan.charge_voltage*10));
  can_word(frames[0], 2, std::lround(plan.charge_amps*10));
  can_word(frames[0], 4, std::lround(plan.discharge_amps*10));
  can_word(frames[0], 6, std::lround(plan.discharge_voltage*10));
  can_word(frames[1], 0, std::lround(soc));
  can_word(frames[1], 2, 100);   // Assumed SOH for compatibility, NOT measured
  can_word(frames[2], 0, std::lround(volts * 100));
  can_word(frames[2], 2, std::lround(amps * 10)); // positive = charging
  can_word(frames[2], 4, std::lround(temperature * 10)); // single shunt probe
  // Bridge voltage flags only; NOT individual BMS/cell alarm telemetry.
  frames[3].bytes[0]=plan.protection;
  frames[3].bytes[2]=plan.warning;
  frames[3].bytes[4] = 1; // one emulated logical pack, not physical battery count
  frames[3].bytes[5] = 0x50;
  frames[3].bytes[6] = 0x4e;
  frames[4].bytes[0] = (plan.charge_allowed?0x80:0) | (plan.discharge_allowed?0x40:0);
  frames[5].bytes = {{'P','Y','L','O','N',' ',' ',' '}};
  // PYLON LV v2.0 section 2.4.5: installed capacity, uint32 LE, whole Ah.
  const uint32_t capacity=static_cast<uint32_t>(std::lround(plan.capacity_ah));
  for(unsigned i=0;i<4;++i)frames[6].bytes[i]=(capacity>>(8*i))&0xff;
  return frames;
}
} // namespace paw
