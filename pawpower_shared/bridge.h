#pragma once
#include "energy_tracker.h"
#include "disconnect_tracker.h"
#include "battery_settings.h"
#include "pylon_can.h"
#include "pylon_transport.h"
namespace paw {
// Optional display hook. The bridge without a screen leaves this unset.
using SettingsAppliedHook = void (*)();
inline SettingsAppliedHook &settings_applied_hook() { static SettingsAppliedHook hook=nullptr; return hook; }
inline bool apply_profile(const std::string &payload) {
  auto &store=settings_store();
  const auto before=store.revision();
  if(!store.apply(payload)) return false;
  if(store.revision()!=before) {
    pylon_transport().pause("Settings changed; waiting for fresh readings");
    pylon_control().settings_changed();
  }
  if(settings_applied_hook()) settings_applied_hook()();
  return true;
}
}
