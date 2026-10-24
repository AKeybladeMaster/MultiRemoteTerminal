#include <node_api.h>
#include <windows.h>

#include <array>
#include <string>

namespace {
constexpr size_t kMaxSystemDirectoryChars = 32768;

napi_value throw_system_directory_error(napi_env env) {
  napi_throw_error(env, "SYSTEM_DIRECTORY_UNAVAILABLE", "Unable to resolve the Windows system directory");
  return nullptr;
}

napi_value get_system_directory(napi_env env, napi_callback_info) {
  std::array<wchar_t, kMaxSystemDirectoryChars> wide{};
  const UINT wide_length = GetSystemDirectoryW(wide.data(), static_cast<UINT>(wide.size()));
  if (wide_length == 0 || wide_length >= wide.size()) return throw_system_directory_error(env);

  const int utf8_length = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, wide.data(),
      static_cast<int>(wide_length), nullptr, 0, nullptr, nullptr);
  if (utf8_length <= 0) return throw_system_directory_error(env);

  std::string utf8(static_cast<size_t>(utf8_length), '\0');
  const int converted_length = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, wide.data(),
      static_cast<int>(wide_length), utf8.data(), utf8_length, nullptr, nullptr);
  if (converted_length != utf8_length) return throw_system_directory_error(env);

  napi_value result;
  if (napi_create_string_utf8(env, utf8.data(), utf8.size(), &result) != napi_ok) {
    return throw_system_directory_error(env);
  }
  return result;
}

napi_value initialize(napi_env env, napi_value exports) {
  napi_value method;
  if (napi_create_function(env, "getSystemDirectory", NAPI_AUTO_LENGTH, get_system_directory, nullptr, &method) != napi_ok ||
      napi_set_named_property(env, exports, "getSystemDirectory", method) != napi_ok) {
    return throw_system_directory_error(env);
  }
  return exports;
}
}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
