#pragma once
#include "../pawpower_shared/pylon_can.h"
#include "cloud_uploader.h"
#include "esp_random.h"
#include <ctime>
namespace pawcloud {
class BatteryControl {
 public:
  std::string report() {
    ensure_boot();
    auto json=paw::settings_store().json();json.pop_back();
    json+=",\"boot\":\""+boot_+"\",\"ack\":{\"id\":\""+last_id_+"\",\"applied\":"+(applied_?"true":"false")+"}}";
    return json;
  }
  void receive(const std::string &json) {
    if(json.empty())return;
    ensure_boot();
    esphome::json::parse_json(json,[this](JsonObject root)->bool{
      auto command=root["command"].as<JsonObject>();
      if(command.isNull())return true;
      const std::string id=command["id"]|"",boot=command["boot"]|"";
      if(id.size()!=32 || id.find_first_not_of("0123456789abcdef")!=std::string::npos)return false;
      if(id==last_id_)return true;
      last_id_=id;applied_=false;
      if(boot!=boot_ || !command["revision"].is<uint32_t>() ||
          command["revision"].as<uint32_t>()!=paw::settings_store().revision() ||
          !command["expires_at"].is<int64_t>() || std::time(nullptr)>=command["expires_at"].as<int64_t>() ||
          std::time(nullptr)<1700000000)return false;
      auto values=command["values"].as<JsonArray>();
      if(values.size()!=paw::SETTING_COUNT)return false;
      std::string payload=std::to_string(paw::settings_store().revision())+"|";
      for(unsigned i=0;i<paw::SETTING_COUNT;++i){
        if(!values[i].is<float>())return false;
        const float v=values[i].as<float>();if(!std::isfinite(v))return false;
        if(i)payload+=",";
        payload+=std::to_string(v);
      }
      applied_=paw::settings_store().apply(payload);
      if(applied_)paw::pylon_control().settings_changed();
      return true;
    });
  }
 private:
  void ensure_boot(){if(boot_.empty()){char b[17];snprintf(b,sizeof(b),"%08lx%08lx",static_cast<unsigned long>(esp_random()),static_cast<unsigned long>(esp_random()));boot_=b;}}
  std::string boot_,last_id_;
  bool applied_=false;
};
inline BatteryControl &battery_control(){static BatteryControl c;return c;}
}
