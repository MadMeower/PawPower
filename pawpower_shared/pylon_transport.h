#pragma once
#include "pylon_can.h"
#include "traffic_activity.h"
#include "driver/twai.h"
#include "esphome/core/log.h"
#include "esphome/core/hal.h"
#include <string>

namespace paw {
// Own the ESP-IDF v2 handle so stale-data shutdown can abort hardware TX and
// clear its queue. Do not also declare an ESPHome canbus component on this CAN.
class PylonTransport {
 public:
  bool setup(gpio_num_t tx=GPIO_NUM_15, gpio_num_t rx=GPIO_NUM_16) {
    twai_general_config_t general=TWAI_GENERAL_CONFIG_DEFAULT(tx,rx,TWAI_MODE_NORMAL);
    general.tx_queue_len=7;general.rx_queue_len=10;
    general.alerts_enabled=TWAI_ALERT_TX_SUCCESS;
    twai_timing_config_t timing=TWAI_TIMING_CONFIG_500KBITS();
    twai_filter_config_t filter=TWAI_FILTER_CONFIG_ACCEPT_ALL();
    const auto err=twai_driver_install_v2(&general,&timing,&filter,&handle_);
    if(err!=ESP_OK){status_="CAN initialization failed";ESP_LOGE("pylon","CAN install failed: %d",int(err));return false;}
    status_="Disabled";return true;
  }
  void pause(const char *reason) {
    if(handle_){
      twai_status_info_t state{};
      if(twai_get_status_info_v2(handle_,&state)==ESP_OK){
        if(state.state==TWAI_STATE_RUNNING)twai_stop_v2(handle_);
        else if(state.state==TWAI_STATE_BUS_OFF)twai_initiate_recovery_v2(handle_);
        twai_clear_transmit_queue_v2(handle_);
      }
    }
    set_status(reason);
  }
  void tick(uint32_t ms,bool enabled) {
    if(!handle_){set_status("CAN initialization failed");return;}
    if(!enabled){pause("Disabled");return;}
    if(!settings_store().confirmed()){pause("Review and Apply battery settings before CAN output");return;}
    auto &control=pylon_control();
    if(!control.ready(ms)){pause("Waiting for 3 fresh shunt replies");return;}
    twai_status_info_t state{};
    if(twai_get_status_info_v2(handle_,&state)!=ESP_OK){set_status("CAN status error");return;}
    if(state.state==TWAI_STATE_BUS_OFF){twai_initiate_recovery_v2(handle_);set_status("CAN bus-off; recovering");return;}
    if(state.state==TWAI_STATE_RECOVERING){set_status("CAN bus-off; recovering");return;}
    if(state.state==TWAI_STATE_STOPPED && twai_start_v2(handle_)!=ESP_OK){set_status("CAN start failed");return;}
    // Unsent frames from an earlier cycle must not become stale retries.
    if(state.msgs_to_tx){pause("CAN transmit backlog; retrying fresh next cycle");return;}
    const auto p=control.plan();
    const auto frames=pylon_frames(control.volts(),control.amps(),control.soc(),control.temperature(),p);
    for(const auto &frame:frames){
      twai_message_t message{};
      message.identifier=frame.id;message.data_length_code=frame.length;
      message.ss=1; // one attempt per frame; no indefinite hardware retransmit
      for(unsigned i=0;i<frame.length;++i)message.data[i]=frame.bytes[i];
      if(twai_transmit_v2(handle_,&message,0)!=ESP_OK){pause("CAN transmit error; retrying fresh next cycle");return;}
    }
    // Queueing is not proof of ACK. The status counters are checked next tick.
    if(state.tx_failed_count!=last_failed_){
      last_failed_=state.tx_failed_count;set_status("CAN transmit failure; check peer and termination");
    }else if(!p.discharge_allowed && p.hot_hold)set_status("Active: high-temperature charge hold and SOC/voltage discharge hold");
    else if(p.hot_hold && p.cold_hold)set_status("Active: hot and cold charge holds; check temperature settings");
    else if(p.hot_hold)set_status("Active: high-temperature charge hold");
    else if(!p.discharge_allowed && p.cold_hold)set_status("Active: cold charge hold and SOC/voltage discharge hold");
    else if(!p.discharge_allowed)set_status("Active: SOC/voltage discharge hold");
    else if(p.cold_hold)set_status("Active: cold-temperature charge hold");
    else if(p.soc_hold)set_status("Active: configured SOC charge hold");
    else set_status("Active: charging permitted");
  }
  void poll() {
    if(!handle_)return;
    uint32_t alerts=0;
    if(twai_read_alerts_v2(handle_,&alerts,0)==ESP_OK && (alerts&TWAI_ALERT_TX_SUCCESS))
      traffic_activity().mark(CAN_TX,esphome::millis());
    twai_message_t message{};
    for(unsigned i=0;i<8 && twai_receive_v2(handle_,&message,0)==ESP_OK;++i){
      traffic_activity().mark(CAN_RX,esphome::millis());
      if(!message.extd && !message.rtr && message.identifier==0x305)
        ESP_LOGD("pylon","RX inverter heartbeat 0x305 (%u bytes)",unsigned(message.data_length_code));
    }
  }
  std::string status()const{return status_;}
 private:
  void set_status(const char *s){if(status_!=s){status_=s;ESP_LOGI("pylon","%s",s);}}
  twai_handle_t handle_=nullptr;
  uint32_t last_failed_=0;
  std::string status_="Starting";
};
inline PylonTransport &pylon_transport(){static PylonTransport t;return t;}
}
