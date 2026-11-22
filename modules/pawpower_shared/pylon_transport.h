#pragma once
#include "pylon_can.h"
#include "can_diagnostics.h"
#include "can_tx_cycle.h"
#include "traffic_activity.h"
#include "can_permissions.h"
#include "driver/twai.h"
#include "esphome/core/log.h"
#include "esphome/core/hal.h"
#include <string>

namespace paw {
// Controlled baseline: original seven-frame queue, one batch per second.
// No paced on-loop sender or high-frequency loop request.
class PylonTransport {
 public:
  bool setup(gpio_num_t tx=GPIO_NUM_15,gpio_num_t rx=GPIO_NUM_16){
    twai_general_config_t general=TWAI_GENERAL_CONFIG_DEFAULT(tx,rx,TWAI_MODE_NORMAL);
    general.tx_queue_len=7;general.rx_queue_len=10;
    general.alerts_enabled=TWAI_ALERT_TX_SUCCESS;
    twai_timing_config_t timing=TWAI_TIMING_CONFIG_500KBITS();
    twai_filter_config_t filter=TWAI_FILTER_CONFIG_ACCEPT_ALL();
    const auto err=twai_driver_install_v2(&general,&timing,&filter,&handle_);
    if(err!=ESP_OK){set_status("CAN initialization failed");ESP_LOGE("pylon","CAN install failed: %d",int(err));return false;}
    ESP_LOGI("pylon","CAN baseline TX v3: original 7-frame queue, 500 kbps, 1 second cycle");
    set_status("Disabled");return true;
  }
  void pause(const char *reason){
    pylon_control().cancel_finish("Cancelled: CAN output paused");
    receipt_.cancel();permissions_.clear();
    if(health_.fault())health_.failed();
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
  void tick(uint32_t ms,bool enabled){
    auto &control=pylon_control();
    control.service_finish(ms,enabled);
    if(!handle_){pause("CAN initialization failed");return;}
    if(!enabled){pause("Disabled");return;}
    if(!settings_store().confirmed()){pause("Review and Apply battery settings before CAN output");return;}
    if(!control.ready(ms)){pause("Waiting for 3 fresh shunt replies");return;}
    twai_status_info_t state{};
    if(twai_get_status_info_v2(handle_,&state)!=ESP_OK){pause("CAN status error");return;}
    const bool changed=state.tx_failed_count!=last_failed_ || state.bus_error_count!=last_errors_;
    if(changed){
      diagnostics(state,ms);
      health_.failed();permissions_.clear();
      set_status("CAN transmit failure; check peer and termination");
    }
    last_failed_=state.tx_failed_count;last_errors_=state.bus_error_count;
    if(state.state==TWAI_STATE_BUS_OFF){
      receipt_.cancel();health_.failed();permissions_.clear();
      twai_initiate_recovery_v2(handle_);set_status("CAN bus-off; recovering");return;
    }
    if(state.state==TWAI_STATE_RECOVERING){
      receipt_.cancel();health_.failed();permissions_.clear();set_status("CAN bus-off; recovering");return;
    }
    if(state.msgs_to_tx){
      if(!changed)diagnostics(state,ms);
      health_.failed();pause("CAN transmit backlog; retrying fresh next cycle");return;
    }
    if(state.state==TWAI_STATE_STOPPED){
      receipt_.cancel();
      if(twai_start_v2(handle_)!=ESP_OK){pause("CAN start failed");return;}
    }
    const auto result=receipt_.check(state.msgs_to_tx,state.tx_failed_count,state.bus_error_count);
    if(result==CanBatchReceipt::COMPLETE && !changed){
      permissions_.queued(ms,last_flags_);
      health_.completed(state.tx_error_counter,state.rx_error_counter);
      if(!announced_){
        ESP_LOGI("pylon","CAN baseline TX v3: seven-frame batch completed");
        announced_=true;
      }
      if(!health_.fault())active_status(last_plan_);
      else set_status("CAN transmit failure; check peer and termination");
    }else if(result==CanBatchReceipt::FAILED || changed){
      health_.failed();permissions_.clear();set_status("CAN transmit failure; check peer and termination");
    }
    const auto p=control.plan();
    const auto frames=pylon_frames(control.volts(),control.amps(),control.soc(),control.temperature(),p);
    // Exact original transport behavior: same order, bytes, DLC and single-shot flag.
    for(const auto &frame:frames){
      twai_message_t message{};
      message.identifier=frame.id;message.data_length_code=frame.length;message.ss=1;
      for(unsigned i=0;i<frame.length;++i)message.data[i]=frame.bytes[i];
      const auto err=twai_transmit_v2(handle_,&message,0);
      if(err!=ESP_OK){
        ESP_LOGW("pylon","CAN baseline TX v3 enqueue failure: frame=0x%03X api=%d",unsigned(frame.id),int(err));
        health_.failed();pause("CAN transmit error; retrying fresh next cycle");return;
      }
    }
    last_flags_=frames[4].bytes[0];last_plan_=p;
    receipt_.queued(state.tx_failed_count,state.bus_error_count);
  }
  void poll(){
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
  CanPermissions permissions(uint32_t ms,bool enabled)const {
    return permissions_.get(ms,enabled && settings_store().confirmed());
  }
  std::string permissions_json(uint32_t ms,bool enabled)const {
    const auto p=permissions(ms,enabled);
    return std::string("{\"active\":")+(p.active?"true":"false")+
      ",\"charge\":"+(p.active?(p.charge?"true":"false"):"null")+
      ",\"discharge\":"+(p.active?(p.discharge?"true":"false"):"null")+"}";
  }
 private:
  void diagnostics(const twai_status_info_t &s,uint32_t ms){
    ESP_LOGW("pylon","CAN TX diagnostics: mode=baseline-v3 failed=%u arbitration_lost=%u bus_errors=%u TEC=%u REC=%u pending=%u time=%u",
      unsigned(s.tx_failed_count),unsigned(s.arb_lost_count),unsigned(s.bus_error_count),
      unsigned(s.tx_error_counter),unsigned(s.rx_error_counter),unsigned(s.msgs_to_tx),unsigned(ms));
  }
  void active_status(const PylonPlan &p){
    if(!p.discharge_allowed && p.hot_hold)set_status("Active: high-temperature charge hold and SOC/voltage discharge hold");
    else if(p.hot_hold && p.cold_hold)set_status("Active: hot and cold charge holds; check temperature settings");
    else if(p.hot_hold)set_status("Active: high-temperature charge hold");
    else if(!p.discharge_allowed && p.cold_hold)set_status("Active: cold charge hold and SOC/voltage discharge hold");
    else if(!p.discharge_allowed)set_status("Active: SOC/voltage discharge hold");
    else if(p.cold_hold)set_status("Active: cold-temperature charge hold");
    else if(p.finish_charge)set_status("Active: finish charge; SOC cutoff bypassed");
    else if(p.soc_hold)set_status("Active: configured SOC charge hold");
    else set_status("Active: charging permitted");
  }
  void set_status(const char *s){if(status_!=s){status_=s;ESP_LOGI("pylon","%s",s);}}
  twai_handle_t handle_=nullptr;
  uint32_t last_failed_=0,last_errors_=0;
  uint8_t last_flags_=0;
  bool announced_=false;
  CanBatchReceipt receipt_;
  CanTxHealth health_;
  PylonPlan last_plan_;
  CanPermissionSnapshot permissions_;
  std::string status_="Starting";
};
inline PylonTransport &pylon_transport(){static PylonTransport t;return t;}
}
