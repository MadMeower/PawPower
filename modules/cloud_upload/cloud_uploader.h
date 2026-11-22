#pragma once
#include <atomic>
#include <algorithm>
#include <cstring>
#include <string>
#include "preferences_fragments.h"
#include "esp_http_client.h"
#include "esp_crt_bundle.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "esphome/components/json/json_util.h"

namespace pawcloud {
// Only immutable snapshots cross the task boundary. HTTP/TLS never runs on the bus loop.
class Uploader {
 public:
  enum Status { WAITING, QUEUED, ACCEPTED, NETWORK_ERROR, AUTH_ERROR, SERVER_ERROR, LOCAL_ERROR };
  enum TestStatus { READY, TEST_QUEUED, SENT, PARTIAL, COOLDOWN, DISABLED, NO_PHONE,
                    TEST_AUTH_ERROR, ENDPOINT_MISSING, TEST_NETWORK_ERROR, TEST_FAILED, SETUP_ERROR };
  using ArchiveSource=std::string(*)();using ArchiveAccepted=void(*)();
  void set_archive_source(ArchiveSource source,ArchiveAccepted accepted){archive_accepted_.store(accepted);archive_source_.store(source);}
  bool start(const char *url, const char *token) {
    if (!uploads_enabled_.load()) return false;
    if (queue_) return task_ != nullptr;
    const size_t length = std::strlen(token);
    if (length < 32 || length > 256) { status_ = LOCAL_ERROR; return false; }
    for (size_t i = 0; i < length; ++i) {
      const char c = token[i];
      if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
            (c >= '0' && c <= '9') || c == '_' || c == '-')) {
        status_ = LOCAL_ERROR; return false;
      }
    }
    url_ = url;
    const auto api = url_.find("/api.php?");
    if (url_.rfind("https://", 0) != 0 || api == std::string::npos) { status_ = LOCAL_ERROR; return false; }
    base_url_ = url_.substr(0, api);
    test_url_ = base_url_ + "/device-test.php?device=" +
        (url_.find("device=tracer") != std::string::npos ? "tracer" : "pawpower");
    battery_ = url_.find("device=pawpower") != std::string::npos;
    bearer_ = std::string("Bearer ") + token;
    if (battery_) {
      config_requests_ = xQueueCreate(1, sizeof(ConfigMessage));
      config_results_ = xQueueCreate(1, sizeof(ConfigMessage));
      battery_requests_ = xQueueCreate(1, sizeof(ConfigMessage));
      battery_results_ = xQueueCreate(1, sizeof(ConfigMessage));
      if (!config_requests_ || !config_results_ || !battery_requests_ || !battery_results_) {
        if (config_requests_) vQueueDelete(config_requests_);
        if (config_results_) vQueueDelete(config_results_);
        if (battery_requests_) vQueueDelete(battery_requests_);
        if (battery_results_) vQueueDelete(battery_results_);
        battery_requests_ = nullptr; battery_results_ = nullptr;
        config_requests_ = nullptr; config_results_ = nullptr;
        status_ = LOCAL_ERROR; return false;
      }
    }
    equipment_requests_ = xQueueCreate(1, sizeof(ConfigMessage));
    equipment_results_ = xQueueCreate(1, sizeof(ConfigMessage));
    queue_ = xQueueCreate(1, sizeof(Snapshot));
    if (!queue_ || !equipment_requests_ || !equipment_results_) {
      if (queue_) vQueueDelete(queue_);
      queue_ = nullptr;
      if (equipment_requests_) vQueueDelete(equipment_requests_);
      if (equipment_results_) vQueueDelete(equipment_results_);
      equipment_requests_ = nullptr; equipment_results_ = nullptr;
      if (config_requests_) vQueueDelete(config_requests_);
      if (config_results_) vQueueDelete(config_results_);
      if (battery_requests_) vQueueDelete(battery_requests_);
      if (battery_results_) vQueueDelete(battery_results_);
      battery_requests_ = nullptr; battery_results_ = nullptr;
      config_requests_ = nullptr; config_results_ = nullptr;
      status_ = LOCAL_ERROR; return false;
    }
    if (xTaskCreate(run, "paw_cloud", 12288, this, 1, &task_) != pdPASS) {
      vQueueDelete(queue_); queue_ = nullptr; task_ = nullptr;
      vQueueDelete(equipment_requests_);vQueueDelete(equipment_results_);
      equipment_requests_ = nullptr;equipment_results_ = nullptr;
      if (config_requests_) vQueueDelete(config_requests_);
      if (config_results_) vQueueDelete(config_results_);
      if (battery_requests_) vQueueDelete(battery_requests_);
      if (battery_results_) vQueueDelete(battery_results_);
      battery_requests_ = nullptr; battery_results_ = nullptr;
      config_requests_ = nullptr; config_results_ = nullptr;
      status_ = LOCAL_ERROR; return false;
    }
    return true;
  }

  void set_uploads_enabled(bool enabled) {
    uploads_enabled_ = enabled;
    if (!enabled) {
      if (queue_) xQueueReset(queue_);
      if (config_requests_) xQueueReset(config_requests_);
      if (config_results_) xQueueReset(config_results_);
      if (battery_requests_) xQueueReset(battery_requests_);
      if (battery_results_) xQueueReset(battery_results_);
      if (equipment_requests_) xQueueReset(equipment_requests_);
      if (equipment_results_) xQueueReset(equipment_results_);
      equipment_cached_ = R"({"status":423})";
      test_pending_ = false;
      test_status_ = READY;
      preferences_fragments_.clear();
      config_cached_ = "{\"status\":423}";
    }
  }

  bool submit(const std::string &json, const std::string &days = "[]", const std::string &history_json = "", const std::string &equipment_json = "{}", const std::string &errors_json = "{}") {
    if (!uploads_enabled_.load()) return false;
    if (!queue_ || !task_ || json.size() >= sizeof(Snapshot::body)) return false;
    if (history_json.size() >= sizeof(Snapshot::history_body) || equipment_json.size() >= sizeof(Snapshot::equipment)) return false;
    if(errors_json.size()>=sizeof(Snapshot::errors))return false;
    // Dedicated loop/worker storage: never place multi-KiB queue packets on task stacks.
    auto &snapshot = loop_snapshot_;
    std::memset(&snapshot, 0, sizeof(snapshot));
    const auto &history = history_json.empty() ? json : history_json;
    std::memcpy(snapshot.history_body, history.c_str(), history.size() + 1);
    if (days.size() < sizeof(snapshot.days)) std::memcpy(snapshot.days, days.c_str(), days.size() + 1);
    else std::memcpy(snapshot.days, "[]", 3);
    std::memcpy(snapshot.equipment, equipment_json.c_str(), equipment_json.size() + 1);
    std::memcpy(snapshot.errors,errors_json.c_str(),errors_json.size()+1);
    snapshot.created_us = esp_timer_get_time();
    std::memcpy(snapshot.body, json.c_str(), json.size() + 1);
    status_ = QUEUED;
    return xQueueOverwrite(queue_, &snapshot) == pdPASS;
  }

  // Configuration crosses the same worker boundary as readings; no HTTP on the bus loop.
  void request_configuration(const std::string &body) {
    if (!uploads_enabled_.load() || !config_requests_) return;
    const auto part=preferences_fragments_.accept(body,esp_timer_get_time());
    if(part==PreferencesFragments::PARTIAL)return;
    if(part==PreferencesFragments::INVALID){
      config_cached_="{\"sequence\":"+std::to_string(++config_sequence_)+",\"status\":400}";return;
    }
    const auto &request=part==PreferencesFragments::READY?preferences_fragments_.body():body;
    if(request.size()>=sizeof(ConfigMessage::body))return;
    auto &message = loop_message_;
    std::memset(&message, 0, sizeof(message));
    message.sequence = ++config_sequence_;
    std::memcpy(message.body, request.c_str(), request.size() + 1);
    xQueueOverwrite(config_requests_, &message);
    if(part==PreferencesFragments::READY)preferences_fragments_.clear();
  }
  std::string configuration() {
    if (!uploads_enabled_.load()) return "{\"status\":423}";
    auto &message = loop_message_;
    std::memset(&message, 0, sizeof(message));
    if (config_results_ && xQueueReceive(config_results_, &message, 0) == pdTRUE)
      config_cached_ = message.body;
    return config_cached_;
  }
  // Equipment preferences sync only after an explicit page read/save request.
  void request_equipment_configuration(const std::string &body) {
    if(!uploads_enabled_.load() || !equipment_requests_ || body.empty() || body.size()>=sizeof(ConfigMessage::body))return;
    auto &m=loop_message_;std::memset(&m,0,sizeof(m));m.sequence=++equipment_sequence_;
    std::memcpy(m.body,body.c_str(),body.size()+1);xQueueOverwrite(equipment_requests_,&m);
  }
  std::string equipment_configuration() {
    if(!uploads_enabled_.load())return R"({"status":423})";
    auto &m=loop_message_;
    if(equipment_results_ && xQueueReceive(equipment_results_,&m,0)==pdTRUE)equipment_cached_=m.body;
    return equipment_cached_;
  }
  void report_battery(const std::string &body) {
    if (!uploads_enabled_.load() || !battery_requests_ || body.size() >= sizeof(ConfigMessage::body)) return;
    auto &m = loop_message_;
    std::memset(&m, 0, sizeof(m));
    std::memcpy(m.body,body.c_str(),body.size()+1);xQueueOverwrite(battery_requests_,&m);
  }
  std::string take_battery_command() {
    auto &m = loop_message_;
    if (!uploads_enabled_.load() || !battery_results_ || xQueueReceive(battery_results_,&m,0)!=pdTRUE) return "";
    return m.body;
  }
  const char *history_status() const {
    if (!uploads_enabled_.load()) return "Cloud support off";
    switch (history_status_.load()) {
      case 1: return "History snapshot stored";
      case 2: return "History server files need uploading";
      case 3: return "History device token rejected";
      case 4: return "History upload failed; next snapshot will retry";
      default: return "Waiting for a cloud snapshot";
    }
  }
  const char *alert_status() const {
    if (!uploads_enabled_.load()) return "Cloud support off";
    switch (alert_status_.load()) {
      case 1: return "Alert rules checked by server";
      case 2: return "Notification server files need uploading";
      case 3: return "Notification device token rejected";
      case 4: return "Notification check failed; next snapshot will retry";
      default: return "Waiting for a fresh cloud snapshot";
    }
  }

  // Called only on the ESPHome loop. Separate atomic flag prevents snapshot overwrites.
  void request_test() {
    if (!uploads_enabled_.load()) { ++test_sequence_; return; }
    if (test_pending_.load() || test_status_.load() == TEST_QUEUED) return;
    ++test_sequence_;
    if (!queue_ || !task_) { test_status_ = SETUP_ERROR; return; }
    const int64_t now = esp_timer_get_time();
    if (last_test_us_ && now - last_test_us_ < 60000000LL) { test_status_ = COOLDOWN; return; }
    last_test_us_ = now;
    test_status_ = TEST_QUEUED;
    test_pending_ = true;
  }

  const char *status() const {
    if (!uploads_enabled_.load()) return "Cloud support off";
    switch (status_.load()) {
      case QUEUED: return "Upload queued";
      case ACCEPTED: return "Latest upload accepted";
      case NETWORK_ERROR: return "Cloud connection failed - retrying next snapshot";
      case AUTH_ERROR: return "Device upload token rejected";
      case SERVER_ERROR: return "Cloud upload rejected - check server";
      case LOCAL_ERROR: return "Cloud uploader setup failed";
      default: return "Waiting for Wi-Fi and clock";
    }
  }

  uint16_t upload_diagnostic()const {
    const auto s=status_.load()==LOCAL_ERROR?LOCAL_ERROR:last_upload_status_.load();
    return s==ACCEPTED?0:s==NETWORK_ERROR?1:s==AUTH_ERROR?2:s==SERVER_ERROR?3:s==LOCAL_ERROR?4:65535;
  }
  int monitor_diagnostic()const{return alert_status_.load();}
  int history_diagnostic()const{return history_status_.load();}
  std::string test_status() const {
    // Machine-readable status contains no credentials or server response body.
    return "{\"sequence\":" + std::to_string(test_sequence_.load()) +
        ",\"state\":" + std::to_string(uploads_enabled_.load() ? static_cast<int>(test_status_.load()) : 12) + "}";
  }

 private:
  struct Snapshot { int64_t created_us; char body[1024]; char days[1024]; char history_body[1024]; char equipment[512]; char errors[2048]; };
  struct Reply { esp_err_t error; int status; std::string body; };
  struct ConfigMessage { uint32_t sequence; char body[2048]; };
  Snapshot loop_snapshot_{}, worker_snapshot_{};
  ConfigMessage loop_message_{}, worker_message_{}, worker_reply_{};
  PreferencesFragments preferences_fragments_;
  uint32_t config_sequence_ = 0, equipment_sequence_ = 0;
  QueueHandle_t equipment_requests_ = nullptr, equipment_results_ = nullptr;
  std::string equipment_cached_ = R"({"status":0})";
  QueueHandle_t config_requests_ = nullptr, config_results_ = nullptr;
  QueueHandle_t battery_requests_ = nullptr, battery_results_ = nullptr;
  bool battery_ = false;
  bool log_supported_ = false; // Negotiated with the existing history endpoint.
  std::atomic<ArchiveSource> archive_source_{nullptr};std::atomic<ArchiveAccepted> archive_accepted_{nullptr};
  std::string config_cached_ = "{\"status\":0}";
  std::atomic<int> alert_status_{0};
  std::atomic<int> history_status_{0};
  QueueHandle_t queue_ = nullptr;
  TaskHandle_t task_ = nullptr;
  std::string url_, base_url_, test_url_, bearer_;
  std::atomic<Status> status_{WAITING},last_upload_status_{WAITING};
  std::atomic<bool> uploads_enabled_{false};
  std::atomic<TestStatus> test_status_{READY};
  std::atomic<uint32_t> test_sequence_{0};
  std::atomic<bool> test_pending_{false};
  int64_t last_test_us_ = 0;

  static esp_err_t capture(esp_http_client_event_t *event) {
    if (event->event_id == HTTP_EVENT_ON_DATA && event->user_data && event->data_len > 0) {
      auto &body = *static_cast<std::string *>(event->user_data);
      const size_t available = 2048 - body.size();
      body.append(static_cast<const char *>(event->data),
          std::min(available, static_cast<size_t>(event->data_len)));
    }
    return ESP_OK;
  }

  Reply send(const std::string &url, const char *body, bool capture_body, bool get = false) {
    Reply reply{ESP_FAIL, 0, {}};
    if (!uploads_enabled_.load()) return reply;
    esp_http_client_config_t config{};
    config.url = url.c_str();
    config.method = get ? HTTP_METHOD_GET : HTTP_METHOD_POST;
    config.timeout_ms = 5000;
    config.crt_bundle_attach = esp_crt_bundle_attach;
    config.disable_auto_redirect = true;
    if (capture_body) { config.event_handler = capture; config.user_data = &reply.body; }
    auto client = esp_http_client_init(&config);
    if (!client) return reply;
    esp_http_client_set_header(client, "Authorization", bearer_.c_str());
    esp_http_client_set_header(client, "Content-Type", "application/json");
    esp_http_client_set_header(client, "Accept", "application/json");
    if (!get) esp_http_client_set_post_field(client, body, std::strlen(body));
    if (!uploads_enabled_.load()) { esp_http_client_cleanup(client); return reply; }
    reply.error = esp_http_client_perform(client);
    reply.status = esp_http_client_get_status_code(client);
    esp_http_client_cleanup(client);
    return reply;
  }

  void send_test() {
    const auto reply = send(test_url_, "{\"test\":true}", true);
    if (reply.error != ESP_OK) { test_status_ = TEST_NETWORK_ERROR; return; }
    if (reply.status == 401) { test_status_ = TEST_AUTH_ERROR; return; }
    if (reply.status == 404) { test_status_ = ENDPOINT_MISSING; return; }
    if (reply.status != 200) { test_status_ = TEST_FAILED; return; }
    test_status_ = TEST_FAILED;
    esphome::json::parse_json(reply.body, [this](JsonObject root) -> bool {
      if (root["sent"].is<int>() && root["sent"].as<int>() > 0) {
        test_status_ = root["failed"].as<int>() > 0 ? PARTIAL : SENT;
      } else {
        const std::string reason = root["reason"] | "";
        if (reason == "cooldown") test_status_ = COOLDOWN;
        else if (reason == "push_disabled") test_status_ = DISABLED;
        else if (reason == "no_registered_phone") test_status_ = NO_PHONE;
      }
      return true;
    });
  }

  void sync_configuration(const char *body, bool get, uint32_t sequence) {
    const auto reply = send(base_url_ + "/notification-preferences.php?device=pawpower", body, true, get);
    bool json_ok = false;
    if (reply.error == ESP_OK && reply.body.size() < 1980) {
      json_ok = esphome::json::parse_json(reply.body, [](JsonObject root) -> bool { return !root.isNull(); });
    }
    const int status = reply.error == ESP_OK ? reply.status : 503;
    const auto result = std::string("{\"sequence\":") + std::to_string(sequence) +
        ",\"status\":" + std::to_string(status) +
        ",\"data\":" + (json_ok ? reply.body : "{}") + "}";
    auto &message = worker_reply_;
    std::memset(&message, 0, sizeof(message));
    if (result.size() < sizeof(message.body)) {
      std::memcpy(message.body, result.c_str(), result.size() + 1);
      xQueueOverwrite(config_results_, &message);
    }
  }

  void sync_equipment_configuration(const char *body,uint32_t sequence) {
    const auto reply=send(base_url_+"/equipment-preferences.php?device="+(battery_?"pawpower":"tracer"),body,true,std::strcmp(body,"GET")==0);
    bool valid=false;
    if(reply.error==ESP_OK && reply.body.size()<1980)
      valid=esphome::json::parse_json(reply.body,[](JsonObject root)->bool{return !root.isNull();});
    const std::string result=std::string(R"({"sequence":)")+std::to_string(sequence)+
      R"(,"status":)"+std::to_string(reply.error==ESP_OK?reply.status:503)+
      R"(,"data":)"+(valid?reply.body:"{}")+"}";
    auto &m=worker_reply_;std::memset(&m,0,sizeof(m));
    if(result.size()<sizeof(m.body)){std::memcpy(m.body,result.c_str(),result.size()+1);xQueueOverwrite(equipment_results_,&m);}
  }
  static void run(void *context) { static_cast<Uploader *>(context)->work(); }
  void work() {
    auto &snapshot = worker_snapshot_;
    auto &config = worker_message_;
    int64_t next_config = 0;
    for (;;) {
      if (!uploads_enabled_.load()) { vTaskDelay(pdMS_TO_TICKS(250)); continue; }
      if (battery_) {
        if (xQueueReceive(config_requests_, &config, 0) == pdTRUE) {
          sync_configuration(config.body, false, config.sequence);
          next_config = esp_timer_get_time() + 30000000LL;
        } else if (esp_timer_get_time() >= next_config) {
          sync_configuration("", true, config.sequence);
          next_config = esp_timer_get_time() + 30000000LL;
        }
      }
      if (battery_ && xQueueReceive(battery_requests_, &config, 0) == pdTRUE) {
        const auto reply=send(base_url_+"/battery-settings.php?device=pawpower",config.body,true);
        if (reply.error==ESP_OK && reply.status==200 && reply.body.size()<sizeof(config.body)) {
          std::memcpy(config.body,reply.body.c_str(),reply.body.size()+1);
          xQueueOverwrite(battery_results_,&config);
        }
      }
      if(xQueueReceive(equipment_requests_,&config,0)==pdTRUE)sync_equipment_configuration(config.body,config.sequence);
      if (test_pending_.exchange(false)) send_test();
      if (xQueueReceive(queue_, &snapshot, pdMS_TO_TICKS(500)) != pdTRUE) continue;
      if (!uploads_enabled_.load() || esp_timer_get_time() - snapshot.created_us > 15000000LL) continue;
      const auto reply = send(url_, snapshot.body, false);
      const auto result = reply.error != ESP_OK ? NETWORK_ERROR :
          reply.status == 200 ? ACCEPTED : reply.status == 401 ? AUTH_ERROR : SERVER_ERROR;
      last_upload_status_=result;status_=result;
      if (uploads_enabled_.load() && esp_timer_get_time() - snapshot.created_us <= 15000000LL) {
        std::string monitor(snapshot.body);if(!monitor.empty())monitor.pop_back();
        monitor += R"(,"equipment":)" + std::string(snapshot.equipment) + "}";
        const auto alert = send(base_url_ + "/device-monitor.php?device=" + (battery_ ? "pawpower" : "tracer"), monitor.c_str(), false);
        alert_status_ = alert.error == ESP_OK && alert.status == 200 ? 1 :
            alert.status == 404 ? 2 : alert.status == 401 ? 3 : 4;
      }
      if (uploads_enabled_.load() && esp_timer_get_time() - snapshot.created_us <= 25000000LL) {
        const std::string history_url = (base_url_ + "/history.php?device=") +
            (battery_ ? "pawpower" : "tracer");
        std::string history_body(snapshot.history_body);
        if (!history_body.empty()) history_body.pop_back();
        history_body += ",\"days\":" + std::string(snapshot.days);
        const auto provider=archive_source_.load();
        const auto archive=log_supported_&&provider?provider():std::string{};
        const bool logs=log_supported_&&(std::strlen(snapshot.errors)>2 || !archive.empty());
        if(logs)history_body+=",\"logs\":{\"errors\":"+std::string(snapshot.errors)+
          (archive.empty()?std::string{}:",\"archive\":"+archive)+"}";
        history_body+="}";
        const auto history = send(history_url, history_body.c_str(), true);
        if(history.status==400||history.status==413)log_supported_=false;
        if(history.error==ESP_OK&&history.status==200){
          log_supported_=false;
          bool accepted=false;
          esphome::json::parse_json(history.body,[&](JsonObject root)->bool{log_supported_=root["logs_supported"].is<bool>()&&root["logs_supported"].as<bool>();accepted=root["logs"].is<bool>()&&root["logs"].as<bool>();return true;});
          if(logs&&accepted&&!archive.empty())if(const auto ack=archive_accepted_.load())ack();
        }
        history_status_ = history.error == ESP_OK && history.status == 200 ? 1 :
            history.status == 404 ? 2 : history.status == 401 ? 3 : 4;
      }
      // Uploads and alert checks use fresh snapshots only; tests are not automatically repeated.
    }
  }
};
inline Uploader &uploader() { static Uploader instance; return instance; }
}
