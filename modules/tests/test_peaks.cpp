#include "../tracer_shared/solar_peaks.h"
#include <cassert>
#include <cstdlib>
int main(){
 setenv("TZ","UTC",1);tzset();const time_t t=1794744000;
 pawtracer::PeakBytes bytes{};
 pawtracer::peak(bytes,t,0,1250);pawtracer::peak(bytes,t,0,1000);
 pawtracer::peak(bytes,t,1,12.5);pawtracer::peak(bytes,t,2,25);pawtracer::peak(bytes,t,2,-7);
 pawtracer::peak(bytes,t,3,26);pawtracer::peak(bytes,t,3,25);
 auto s=pawtracer::load(bytes);assert(s.days[0].watts==1250&&s.days[0].charge_amps==25&&s.days[0].discharge_amps==7&&s.days[0].temperature==26);
 pawtracer::peak(bytes,t+86400,0,800);s=pawtracer::load(bytes);assert(s.days[0].watts==800&&s.days[1].watts==1250);
 pawtracer::peak(bytes,t,0,9999);s=pawtracer::load(bytes);assert(s.days[1].watts==9999&&s.days[0].watts==800);
 paw::EnergyBytes e{};auto energy=paw::load_energy(e);auto d=paw::ensure(energy,paw::date_key(t));d->charged_wh=1000;std::memcpy(e.data(),&energy,sizeof(energy));
 auto json=pawtracer::history(e,bytes,t+86400,true);assert(json.find("\"max_charge_a\":25.000000")!=std::string::npos);
 assert(pawtracer::history(e,bytes,t,false)=="{\"clock\":false,\"days\":[]}");
}
