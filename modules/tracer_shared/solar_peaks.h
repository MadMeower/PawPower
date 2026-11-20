#pragma once
#include "pawpower_common/energy_tracker.h"
namespace pawtracer {
struct PeakDay {int32_t date=0;float watts=0,solar_amps=0,charge_amps=0,discharge_amps=0,temperature=-273;uint32_t seen=0;};
struct PeakStore {uint32_t version=1;std::array<PeakDay,31> days{};};
using PeakBytes=std::array<uint8_t,1024>;
static_assert(sizeof(PeakStore)<=sizeof(PeakBytes),"Peak storage too small");
inline PeakStore load(const PeakBytes &b){PeakStore s{};std::memcpy(&s,b.data(),sizeof(s));return s.version==1?s:PeakStore{};}
inline void peak(PeakBytes &bytes,time_t epoch,int field,float value){
 if(!std::isfinite(value))return;
 auto s=load(bytes);const auto key=paw::date_key(epoch);PeakDay *d=nullptr;
 for(auto &row:s.days)if(row.date==key){d=&row;break;}
 if(!d){if(key<s.days[0].date)return;for(size_t i=30;i>0;--i)s.days[i]=s.days[i-1];s.days[0]=PeakDay{};d=&s.days[0];d->date=key;}
 if(field==0 && value>=0 && value<=15000){d->watts=std::max(d->watts,value);d->seen|=1;}
 if(field==1 && value>=0 && value<=200){d->solar_amps=std::max(d->solar_amps,value);d->seen|=2;}
 if(field==2 && std::fabs(value)<=200){d->charge_amps=std::max(d->charge_amps,value);d->discharge_amps=std::max(d->discharge_amps,-value);d->seen|=4;}
 if(field==3 && value>=-100 && value<=150){d->temperature=std::max(d->temperature,value);d->seen|=8;}
 std::memcpy(bytes.data(),&s,sizeof(s));
}
inline std::string history(paw::EnergyBytes &energy,const PeakBytes &bytes,time_t epoch,bool valid){
 auto out=paw::energy_json(energy,epoch,valid);if(!valid)return out;auto peaks=load(bytes);
 for(const auto &d:peaks.days){if(!d.date)continue;char date[40];std::snprintf(date,sizeof(date),"\"date\":\"%04d-%02d-%02d\"",int(d.date/10000),int(d.date/100%100),int(d.date%100));
 auto pos=out.find(date);if(pos==std::string::npos)continue;auto end=out.find('}',pos);if(end==std::string::npos)continue;
 auto num=[](bool seen,float v){return seen?std::to_string(v):std::string("null");};
 out.insert(end,",\"max_w\":"+num(d.seen&1,d.watts)+",\"max_pv_a\":"+num(d.seen&2,d.solar_amps)+",\"max_charge_a\":"+num(d.seen&4,d.charge_amps)+",\"max_discharge_a\":"+num(d.seen&4,d.discharge_amps)+",\"max_temp_c\":"+num(d.seen&8,d.temperature));
 }return out;
}
}
