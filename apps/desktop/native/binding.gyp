{
  "targets": [
    {
      "target_name": "system_directory",
      "sources": [ "system_directory.cc" ],
      "defines": [ "NAPI_VERSION=8", "WIN32_LEAN_AND_MEAN", "NOMINMAX" ],
      "libraries": [ "Shell32.lib", "Ole32.lib" ],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "ExceptionHandling": 1,
          "WarningLevel": 4
        }
      }
    }
  ]
}
