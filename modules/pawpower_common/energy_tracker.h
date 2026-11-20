#pragma once
#include <array>
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <ctime>
#include <cstring>
#include <string>
#include <type_traits>

namespace paw {
struct EnergyDay {
  int32_t date = 0;
  double charged_wh = 0;
  double discharged_wh = 0;
  double seconds = 0;
  bool partial = false;
};
struct EnergyStore {
  uint32_t version = 1;
  std::array<EnergyDay, 31> days{};
};
static_assert(std::is_trivially_copyable<EnergyStore>::value, "Energy history must be persistable");
inline int32_t date_key(time_t epoch) {
  tm local{};
  localtime_r(&epoch, &local);
  return (local.tm_year + 1900)*10000 + (local.tm_mon + 1)*100 + local.tm_mday;
}
inline time_t day_start(time_t epoch, int offset = 0) {
  tm local{};
  localtime_r(&epoch, &local);
  // ESPHome can supply localtime_r without configuring libc's mktime TZ.
  // Find the date boundary using ONLY localtime_r, so both directions agree.
  // Anchor at local noon: +/- one hour at Michigan DST transitions cannot
  // move the requested day into its neighbour when applying calendar offsets.
  const time_t probe = epoch + (12 - local.tm_hour) * 3600
                      - local.tm_min * 60 - local.tm_sec
                      + static_cast<time_t>(offset) * 86400;
  const int32_t target = date_key(probe);
  time_t low = probe - 36 * 3600;
  time_t high = probe;
  while (high - low > 1) {
    const time_t middle = low + (high - low) / 2;
    if (date_key(middle) < target) low = middle;
    else high = middle;
  }
  return high;
}
inline EnergyDay *find(EnergyStore &store, int32_t date) {
  for (auto &day : store.days) if (day.date == date) return &day;
  return nullptr;
}
inline EnergyDay *ensure(EnergyStore &store, int32_t date) {
  if (store.version != 1) store = EnergyStore{};
  if (auto *day = find(store, date)) return day;
  if (date < store.days[0].date) return nullptr;
  for (size_t i = store.days.size()-1; i > 0; --i) store.days[i] = store.days[i-1];
  store.days[0] = EnergyDay{};
  store.days[0].date = date;
  return &store.days[0];
}
// Integral of the positive part of a linearly varying wattage, in watt-seconds.
inline double positive_area(double a, double b, double seconds) {
  if (a >= 0 && b >= 0) return (a+b)*0.5*seconds;
  if (a <= 0 && b <= 0) return 0;
  if (a > 0) return 0.5*a*seconds*a/(a-b);
  return 0.5*b*seconds*b/(b-a);
}
class EnergyTracker {
 public:
  void sample(EnergyStore &store, uint32_t ms, time_t epoch, bool clock_valid, double watts) {
    if (!clock_valid || !std::isfinite(watts)) { have_previous_ = false; return; }
    auto *current = ensure(store, date_key(epoch));
    if (!current) { have_previous_ = false; return; }
    const double dt = static_cast<uint32_t>(ms - previous_ms_)/1000.0;
    const double wall_dt = difftime(epoch, previous_epoch_);
    if (!have_previous_ || dt <= 0 || dt > 20 || std::abs(wall_dt-dt) > 2 || wall_dt <= 0) {
      current->partial = true;
      if (have_previous_) {
        if (auto *old = find(store, date_key(previous_epoch_))) old->partial = true;
      }
    } else {
      // Divide an interval at local midnight; DST days can be 23 or 25 hours.
      time_t from = previous_epoch_;
      while (from < epoch) {
        const time_t boundary = day_start(from, 1);
        const time_t to = std::min(epoch, boundary);
        if (to <= from) break;
        const double f0 = difftime(from, previous_epoch_)/wall_dt;
        const double f1 = difftime(to, previous_epoch_)/wall_dt;
        const double p0 = previous_watts_ + (watts-previous_watts_)*f0;
        const double p1 = previous_watts_ + (watts-previous_watts_)*f1;
        const double seconds = dt*(f1-f0);
        auto *day = ensure(store, date_key(from));
        if (day) {
          day->charged_wh += positive_area(p0,p1,seconds)/3600.0;
          day->discharged_wh += positive_area(-p0,-p1,seconds)/3600.0;
          day->seconds += seconds;
        }
        from = to;
      }
    }
    previous_ms_ = ms;
    previous_epoch_ = epoch;
    previous_watts_ = watts;
    have_previous_ = true;
  }
 private:
  bool have_previous_ = false;
  uint32_t previous_ms_ = 0;
  time_t previous_epoch_ = 0;
  double previous_watts_ = 0;
};
inline EnergyTracker &energy_tracker() { static EnergyTracker tracker; return tracker; }
// Separate persistence keeps the existing energy byte layout and history intact.
// Values are independent maxima; peak watts and amps need not occur together.
struct PeakDay {
  int32_t date = 0;
  float charge_w = 0;
  float discharge_w = 0;
  float charge_a = 0;
  float discharge_a = 0;
};
struct PeakStore {
  uint32_t version = 1;
  std::array<PeakDay,31> days{};
};
using PeakBytes = std::array<uint8_t,768>;
static_assert(std::is_trivially_copyable<PeakStore>::value, "Peaks must be persistable");
static_assert(sizeof(PeakStore) <= sizeof(PeakBytes), "Peak storage too small");
inline PeakStore load_peaks(const PeakBytes &bytes) {
  PeakStore store{};
  std::memcpy(&store,bytes.data(),sizeof(store));
  if (store.version != 1) return PeakStore{};
  return store;
}
inline const PeakDay *find_peak(const PeakStore &store,int32_t date) {
  for (const auto &day : store.days) if (day.date == date) return &day;
  return nullptr;
}
inline void record_peaks(PeakBytes &bytes,time_t epoch,bool clock_valid,float volts,float amps) {
  if (!clock_valid || !std::isfinite(volts) || !std::isfinite(amps) ||
      volts < 0 || volts > 120 || std::fabs(amps) > 600) return;
  auto store=load_peaks(bytes);
  const int32_t date=date_key(epoch);
  PeakDay *day=nullptr;
  for (auto &candidate : store.days) if (candidate.date==date) {day=&candidate;break;}
  if (!day) {
    if (date < store.days[0].date) return;
    for (size_t i=store.days.size()-1;i>0;--i) store.days[i]=store.days[i-1];
    store.days[0]=PeakDay{};
    day=&store.days[0];day->date=date;
  }
  const float watts=volts*amps;
  day->charge_w=std::max(day->charge_w,watts);
  day->discharge_w=std::max(day->discharge_w,-watts);
  day->charge_a=std::max(day->charge_a,amps);
  day->discharge_a=std::max(day->discharge_a,-amps);
  std::memcpy(bytes.data(),&store,sizeof(store));
}
inline std::string energy_json(EnergyStore &store, time_t epoch, bool clock_valid,
                               const PeakStore *peaks=nullptr) {
  if (!clock_valid) return "{\"clock\":false,\"days\":[]}";
  std::string json = "{\"clock\":true,\"days\":[";
  for (int i = 0; i <= 30; ++i) {
    const int32_t key = date_key(day_start(epoch, -i));
    const auto *day = find(store,key);
    char row[256];
    if (day) {
      const double expected = difftime(day_start(epoch,1-i), day_start(epoch,-i));
      const bool partial = day->partial || (i > 0 && day->seconds < expected-20);
      snprintf(row,sizeof(row),"%s{\"date\":\"%04d-%02d-%02d\",\"in\":%.6f,\"out\":%.6f,\"hours\":%.3f,\"partial\":%s}",
        i ? "," : "", static_cast<int>(key/10000),static_cast<int>((key/100)%100),static_cast<int>(key%100),day->charged_wh/1000.0,day->discharged_wh/1000.0,day->seconds/3600.0,partial?"true":"false");
    } else {
      snprintf(row,sizeof(row),"%s{\"date\":\"%04d-%02d-%02d\",\"missing\":true}",i?",":"",static_cast<int>(key/10000),static_cast<int>((key/100)%100),static_cast<int>(key%100));
    }
    if (peaks && day) {
      if (const auto *peak=find_peak(*peaks,key)) {
        // Compact JSON: [charge W, discharge W magnitude, charge A, discharge A magnitude].
        const size_t length=std::strlen(row);
        snprintf(row+length-1,sizeof(row)-length+1,",\"peak\":[%.2f,%.2f,%.2f,%.2f]}",
          peak->charge_w,peak->discharge_w,peak->charge_a,peak->discharge_a);
      }
    }
    json += row;
  }
  return json + "]}";
}
// ESPHome declares globals before user includes. Use a standard byte array there
// and copy the structured state here, after this header has been included.
using EnergyBytes = std::array<uint8_t, 1536>;
static_assert(sizeof(EnergyStore) <= sizeof(EnergyBytes), "History storage too small");
inline EnergyStore load_energy(const EnergyBytes &bytes) {
  EnergyStore store{};
  std::memcpy(&store, bytes.data(), sizeof(store));
  if (store.version != 1) return EnergyStore{};
  return store;
}
inline void record_energy(EnergyBytes &bytes, uint32_t ms, time_t epoch,
                          bool clock_valid, double watts) {
  auto store = load_energy(bytes);
  energy_tracker().sample(store, ms, epoch, clock_valid, watts);
  std::memcpy(bytes.data(), &store, sizeof(store));
}
inline std::string energy_json(EnergyBytes &bytes, time_t epoch, bool clock_valid) {
  auto store = load_energy(bytes);
  return energy_json(store, epoch, clock_valid);
}
inline std::string energy_json(EnergyBytes &bytes,const PeakBytes &peak_bytes,
                               time_t epoch,bool clock_valid) {
  auto store=load_energy(bytes);
  const auto peaks=load_peaks(peak_bytes);
  return energy_json(store,epoch,clock_valid,&peaks);
}

}
