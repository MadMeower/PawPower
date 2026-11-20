#pragma once
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <string>

namespace pawcloud {
constexpr bool fresh(bool seen, uint32_t stamp, uint32_t now, uint32_t limit_ms) {
  return seen && uint32_t(now - stamp) <= limit_ms;
}
static_assert(!fresh(false, 0, 1, 15000), "Unseen data must be unavailable");
static_assert(fresh(true, 0xfffffff0U, 16, 100), "Freshness must survive millis rollover");
static_assert(!fresh(true, 1, 15002, 15000), "Old measurements must be unavailable");

class Payload {
 public:
  Payload() : value_("{\"readings\":{") {}
  void number(const char *field, double value, bool available, double low, double high) {
    if (count_++) value_ += ',';
    value_ += '"'; value_ += field; value_ += "\":";
    if (!available || !std::isfinite(value) || value < low || value > high) {
      value_ += "null";
    } else {
      char number[48];
      std::snprintf(number, sizeof(number), "%.6f", value);
      value_ += number;
    }
  }
  std::string finish() const { return value_ + "}}"; }
 private:
  unsigned count_ = 0;
  std::string value_;
};
}
