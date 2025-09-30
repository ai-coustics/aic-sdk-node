{
  "targets": [
    {
      "target_name": "aic_binding",
      "sources": ["src/binding.cc"],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "sdk/include"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "conditions": [
        ["OS=='linux'", {
          "libraries": [
            "<(module_root_dir)/sdk/lib/libaic.so"
          ],
          "ldflags": [
            "-Wl,-rpath,<(module_root_dir)/sdk/lib"
          ]
        }],
        ["OS=='mac'", {
          "libraries": [
            "../sdk/lib/libaic.dylib"
          ],
          "xcode_settings": {
            "OTHER_LDFLAGS": [
              "-Wl,-rpath,@loader_path/../../sdk/lib"
            ]
          }
        }],
        ["OS=='win'", {
          "libraries": [
            "../sdk/lib/aic.lib",
            "ntdll.lib"
          ],
          "copies": [
            {
              "destination": "<(module_root_dir)/build/Release/",
              "files": ["<(module_root_dir)/sdk/lib/aic.dll"]
            }
          ]
        }]
      ],
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "cflags": ["-fPIC"],
      "cflags_cc": ["-fPIC"]
    }
  ]
}
