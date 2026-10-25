#include <node_api.h>
#include <windows.h>
#include <shlobj.h>

#include <array>
#include <string>

namespace {
constexpr size_t kMaxSystemDirectoryChars = 32768;

napi_value throw_system_directory_error(napi_env env) {
  napi_throw_error(env, "SYSTEM_DIRECTORY_UNAVAILABLE", "Unable to resolve a Windows system directory");
  return nullptr;
}

bool to_utf8(const wchar_t* wide, size_t wide_length, std::string* utf8) {
  if (wide == nullptr || utf8 == nullptr || wide_length == 0 || wide_length >= kMaxSystemDirectoryChars) return false;
  const int utf8_length = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, wide,
      static_cast<int>(wide_length), nullptr, 0, nullptr, nullptr);
  if (utf8_length <= 0) return false;
  utf8->resize(static_cast<size_t>(utf8_length));
  const int converted_length = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, wide,
      static_cast<int>(wide_length), utf8->data(), utf8_length, nullptr, nullptr);
  return converted_length == utf8_length;
}

napi_value get_system_directory(napi_env env, napi_callback_info) {
  std::array<wchar_t, kMaxSystemDirectoryChars> wide{};
  const UINT wide_length = GetSystemDirectoryW(wide.data(), static_cast<UINT>(wide.size()));
  if (wide_length == 0 || wide_length >= wide.size()) return throw_system_directory_error(env);

  std::string utf8;
  if (!to_utf8(wide.data(), wide_length, &utf8)) return throw_system_directory_error(env);

  napi_value result;
  if (napi_create_string_utf8(env, utf8.data(), utf8.size(), &result) != napi_ok) {
    return throw_system_directory_error(env);
  }
  return result;
}

bool resolve_known_folder(REFKNOWNFOLDERID folder_id, std::string* utf8) {
  PWSTR path = nullptr;
  if (SHGetKnownFolderPath(folder_id, KF_FLAG_DEFAULT, nullptr, &path) != S_OK || path == nullptr) {
    if (path != nullptr) CoTaskMemFree(path);
    return false;
  }
  size_t path_length = 0;
  while (path_length < kMaxSystemDirectoryChars && path[path_length] != L'\0') ++path_length;
  const bool converted = to_utf8(path, path_length, utf8);
  CoTaskMemFree(path);
  return converted;
}

napi_value get_program_files_directories(napi_env env, napi_callback_info) {
  std::array<std::string, 2> paths;
  size_t count = 0;
  if (resolve_known_folder(FOLDERID_ProgramFiles, &paths[count])) ++count;
  if (resolve_known_folder(FOLDERID_ProgramFilesX86, &paths[count]) &&
      (count == 0 || paths[count] != paths[0])) ++count;
  if (count == 0) return throw_system_directory_error(env);

  napi_value result;
  if (napi_create_array_with_length(env, count, &result) != napi_ok) return throw_system_directory_error(env);
  for (size_t index = 0; index < count; ++index) {
    napi_value path;
    if (napi_create_string_utf8(env, paths[index].data(), paths[index].size(), &path) != napi_ok ||
        napi_set_element(env, result, static_cast<uint32_t>(index), path) != napi_ok) return throw_system_directory_error(env);
  }
  return result;
}

napi_value initialize(napi_env env, napi_value exports) {
  napi_value method;
  if (napi_create_function(env, "getSystemDirectory", NAPI_AUTO_LENGTH, get_system_directory, nullptr, &method) != napi_ok ||
      napi_set_named_property(env, exports, "getSystemDirectory", method) != napi_ok ||
      napi_create_function(env, "getProgramFilesDirectories", NAPI_AUTO_LENGTH, get_program_files_directories, nullptr, &method) != napi_ok ||
      napi_set_named_property(env, exports, "getProgramFilesDirectories", method) != napi_ok) {
    return throw_system_directory_error(env);
  }
  return exports;
}
}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
