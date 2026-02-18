const { FuseV1Options, FuseVersion } = require("@electron/fuses");
const path = require("path");
const fs = require("fs");

// 平台架构 -> @cometix/codex target triple 映射
const TARGET_TRIPLE_MAP = {
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
  "linux-arm64": "aarch64-unknown-linux-musl",
  "linux-x64": "x86_64-unknown-linux-musl",
  "win32-x64": "x86_64-pc-windows-msvc",
};

const CODEX_NODE_MODULE_PACKAGES = [
  (platformArch) => `@openai/codex-${platformArch}`,
  () => "@openai/codex",
  () => "@cometix/codex",
];

function getBinaryName(platform, tool) {
  if (tool === "codex") {
    return platform === "win32" ? "codex.exe" : "codex";
  }
  if (tool === "rg") {
    return platform === "win32" ? "rg.exe" : "rg";
  }
  throw new Error(`Unsupported binary tool: ${tool}`);
}

function getTargetTriple(platform, arch) {
  return TARGET_TRIPLE_MAP[`${platform}-${arch}`] || null;
}

function getStagedCodexDir(platform, arch) {
  const dirPath = path.join(
    __dirname,
    "resources",
    "bin",
    `${platform}-${arch}`,
  );
  return fs.existsSync(dirPath) ? dirPath : null;
}

function getVendorTargetRoot(packageName, targetTriple) {
  return path.join(
    __dirname,
    "node_modules",
    ...packageName.split("/"),
    "vendor",
    targetTriple,
  );
}

function listFilesFlat(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  return fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(dirPath, entry.name));
}

function getCodexRuntimeFiles(platform, arch) {
  const platformArch = `${platform}-${arch}`;
  const codexName = getBinaryName(platform, "codex");
  const rgName = getBinaryName(platform, "rg");
  const triedPaths = [];

  const stagedDir = getStagedCodexDir(platform, arch);
  if (stagedDir) {
    triedPaths.push(stagedDir);
    const stagedCodex = path.join(stagedDir, codexName);
    const stagedRipgrep = path.join(stagedDir, rgName);

    if (fs.existsSync(stagedCodex) && fs.existsSync(stagedRipgrep)) {
      const files = listFilesFlat(stagedDir).filter(
        (filePath) => path.basename(filePath) !== ".codex-stage.json",
      );
      return {
        platformArch,
        codexName,
        rgName,
        sourceDescription: `resources/bin/${platformArch}`,
        files,
        triedPaths,
      };
    }
  }

  const targetTriple = getTargetTriple(platform, arch);
  if (!targetTriple) {
    return {
      platformArch,
      codexName,
      rgName,
      sourceDescription: null,
      files: [],
      triedPaths,
    };
  }

  const packageSearchOrder = CODEX_NODE_MODULE_PACKAGES.map((resolver) =>
    resolver(platformArch),
  );

  for (const packageName of packageSearchOrder) {
    const vendorTargetRoot = getVendorTargetRoot(packageName, targetTriple);
    triedPaths.push(vendorTargetRoot);

    const codexDir = path.join(vendorTargetRoot, "codex");
    const pathDir = path.join(vendorTargetRoot, "path");
    const codexPath = path.join(codexDir, codexName);
    const rgPath = path.join(pathDir, rgName);

    if (!fs.existsSync(codexPath) || !fs.existsSync(rgPath)) {
      continue;
    }

    const runtimeFiles = [...listFilesFlat(codexDir), rgPath];
    return {
      platformArch,
      codexName,
      rgName,
      sourceDescription: `node_modules/${packageName}/vendor/${targetTriple}`,
      files: [...new Set(runtimeFiles)],
      triedPaths,
    };
  }

  return {
    platformArch,
    codexName,
    rgName,
    sourceDescription: null,
    files: [],
    triedPaths,
  };
}

module.exports = {
  packagerConfig: {
    name: "Codex",
    executableName: "Codex",
    appBundleId: "com.openai.codex",
    icon: "./resources/electron",
    asar: {
      unpack: "{**/*.node,**/node-pty/build/Release/spawn-helper,**/node-pty/prebuilds/*/spawn-helper}",
    },
    extraResource: ["./resources/notification.wav"],
    // 第一层：文件白名单 — 只放行运行时必要的文件，排除 Codex.app/、.github/ 等膨胀源
    ignore: (filePath) => {
      // 根目录本身必须放行
      if (filePath === "") return false;

      // 白名单前缀：运行时需要的顶层路径（对标官方 asar 结构）
      // ignore 函数会收到目录和文件两种路径，需要同时匹配完整路径和中间目录
      const allowedPrefixes = [
        "/src/.vite/build", // 编译后的主进程代码
        "/src/webview",     // 前端 UI 资源
        "/src/skills",      // 技能目录
        "/node_modules",    // 本项目自身的原生依赖（afterPrune 阶段裁剪至仅保留原生模块）
      ];

      // 精确匹配 package.json
      if (filePath === "/package.json") return false;

      // 检查：filePath 是否是某个白名单路径的前缀（即父目录），
      // 或者 filePath 是否在某个白名单路径之下（即子文件/子目录）
      for (const prefix of allowedPrefixes) {
        if (prefix.startsWith(filePath) || filePath.startsWith(prefix)) {
          return false;
        }
      }

      return true;
    },
    // macOS 签名配置
    osxSign: process.env.SKIP_SIGN
      ? undefined
      : {
          identity: process.env.APPLE_IDENTITY,
          identityValidation: false,
        },
    osxNotarize: process.env.SKIP_NOTARIZE
      ? undefined
      : {
          appleId: process.env.APPLE_ID,
          appleIdPassword: process.env.APPLE_PASSWORD,
          teamId: process.env.APPLE_TEAM_ID,
        },
    // Windows 元数据
    win32metadata: {
      CompanyName: "OpenAI",
      ProductName: "Codex",
    },
  },
  rebuildConfig: {},
  makers: [
    // macOS DMG
    {
      name: "@electron-forge/maker-dmg",
      config: {
        format: "ULFO",
        icon: "./resources/electron.icns",
      },
    },
    // macOS ZIP
    {
      name: "@electron-forge/maker-zip",
      platforms: ["darwin"],
    },
    // Windows Squirrel
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        name: "Codex",
        authors: "OpenAI, Cometix Space",
        description: "Codex Desktop App",
        setupIcon: "./resources/electron.ico",
        iconUrl: "https://raw.githubusercontent.com/Haleclipse/CodexDesktop-Rebuild/master/resources/electron.ico",
      },
    },
    // Windows ZIP
    {
      name: "@electron-forge/maker-zip",
      platforms: ["win32"],
    },
    // Linux DEB
    {
      name: "@electron-forge/maker-deb",
      config: {
        options: {
          name: "codex",
          productName: "Codex",
          genericName: "AI Coding Assistant",
          categories: ["Development", "Utility"],
          bin: "Codex",
          maintainer: "Cometix Space",
          homepage: "https://github.com/Haleclipse/CodexDesktop-Rebuild",
          icon: "./resources/electron.png",
        },
      },
    },
    // Linux RPM
    {
      name: "@electron-forge/maker-rpm",
      config: {
        options: {
          name: "codex",
          productName: "Codex",
          genericName: "AI Coding Assistant",
          categories: ["Development", "Utility"],
          bin: "Codex",
          license: "Apache-2.0",
          homepage: "https://github.com/Haleclipse/CodexDesktop-Rebuild",
          icon: "./resources/electron.png",
        },
      },
    },
    // Linux ZIP
    {
      name: "@electron-forge/maker-zip",
      platforms: ["linux"],
    },
  ],
  plugins: [
    {
      name: "@electron-forge/plugin-auto-unpack-natives",
      config: {},
    },
    {
      name: "@electron-forge/plugin-fuses",
      config: {
        version: FuseVersion.V1,
        [FuseV1Options.RunAsNode]: true,
        [FuseV1Options.EnableCookieEncryption]: false,
        [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: true,
        [FuseV1Options.EnableNodeCliInspectArguments]: true,
        [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
        [FuseV1Options.OnlyLoadAppFromAsar]: false,
      },
    },
  ],
  hooks: {
    // 第二层：原生模块平台筛选 — Forge 裁剪 devDependencies 后，进一步清理非目标平台产物
    packageAfterPrune: async (
      config,
      buildPath,
      electronVersion,
      platform,
      arch,
    ) => {
      const platformArch = `${platform}-${arch}`;
      console.log(
        `\n🧹 Pruning non-target platform files for ${platformArch}...`,
      );

      // --- 辅助函数 ---
      const removeDirRecursive = (dirPath) => {
        if (fs.existsSync(dirPath)) {
          fs.rmSync(dirPath, { recursive: true, force: true });
          console.log(`   🗑️  Removed: ${path.relative(buildPath, dirPath)}`);
        }
      };

      const removeFile = (filePath) => {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log(
            `   🗑️  Removed: ${path.relative(buildPath, filePath)}`,
          );
        }
      };

      // 递归遍历目录收集文件
      const walkDir = (dir, callback) => {
        if (!fs.existsSync(dir)) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walkDir(fullPath, callback);
          } else {
            callback(fullPath);
          }
        }
      };

      const nodeModulesPath = path.join(buildPath, "node_modules");

      // 0. 原生模块白名单 — Vite 已将所有纯 JS 依赖 bundle 进 main.js，
      //    node_modules 只需保留不能 bundle 的原生模块及其运行时 binding 辅助包
      //    对标官方构建并补充 Windows 安装所需依赖：
      //    better-sqlite3, bindings, file-uri-to-path, node-addon-api,
      //    node-gyp-build, node-pty, electron-liquid-glass, electron-squirrel-startup
      const allowedModules = new Set([
        "better-sqlite3",        // SQLite 原生模块
        "bindings",              // 原生模块 .node 文件定位器（better-sqlite3 运行时 require）
        "file-uri-to-path",      // bindings 的运行时依赖
        "node-addon-api",        // N-API 辅助（better-sqlite3 运行时需要）
        "node-pty",              // 终端模拟原生模块
        "electron-squirrel-startup", // Windows Squirrel 安装阶段启动参数处理
      ]);

      // 平台条件依赖
      if (platform === "darwin") {
        allowedModules.add("electron-liquid-glass"); // macOS 液态玻璃效果
        allowedModules.add("node-gyp-build");        // electron-liquid-glass 运行时 require
      }

      console.log(
        `   📋 Native module whitelist: ${allowedModules.size} packages`,
      );

      // 删除不在白名单中的所有 node_modules 包
      if (fs.existsSync(nodeModulesPath)) {
        let removedPkgCount = 0;
        const entries = fs.readdirSync(nodeModulesPath);
        for (const entry of entries) {
          // 跳过隐藏文件 (.bin, .package-lock.json)
          if (entry.startsWith(".")) continue;

          if (entry.startsWith("@")) {
            // scoped 包：逐个检查子目录
            const scopePath = path.join(nodeModulesPath, entry);
            if (!fs.statSync(scopePath).isDirectory()) continue;
            const scopedEntries = fs.readdirSync(scopePath);
            for (const scopedEntry of scopedEntries) {
              const fullName = `${entry}/${scopedEntry}`;
              if (!allowedModules.has(fullName)) {
                removeDirRecursive(path.join(scopePath, scopedEntry));
                removedPkgCount++;
              }
            }
            // scope 目录为空则删除
            if (fs.readdirSync(scopePath).length === 0) {
              removeDirRecursive(scopePath);
            }
          } else {
            if (!allowedModules.has(entry)) {
              removeDirRecursive(path.join(nodeModulesPath, entry));
              removedPkgCount++;
            }
          }
        }
        console.log(
          `   🗑️  Removed ${removedPkgCount} non-native packages from node_modules`,
        );
      }

      // 清理 .bin 目录（不需要 bin link）
      const binDir = path.join(nodeModulesPath, ".bin");
      if (fs.existsSync(binDir)) {
        removeDirRecursive(binDir);
      }

      // 1. 清理 node-pty prebuilds 中非目标平台的目录
      const nodePtyPrebuilds = path.join(
        nodeModulesPath,
        "node-pty",
        "prebuilds",
      );
      if (fs.existsSync(nodePtyPrebuilds)) {
        const dirs = fs.readdirSync(nodePtyPrebuilds);
        for (const dir of dirs) {
          if (dir !== platformArch) {
            removeDirRecursive(path.join(nodePtyPrebuilds, dir));
          }
        }
      }

      // 2. 删除所有 .pdb 调试符号文件（Windows 调试用，运行时不需要）
      walkDir(nodeModulesPath, (filePath) => {
        if (filePath.endsWith(".pdb")) {
          removeFile(filePath);
        }
      });

      // 3. 清理 electron-liquid-glass 中非目标平台的 prebuilds
      const liquidGlassPrebuilds = path.join(
        nodeModulesPath,
        "electron-liquid-glass",
        "prebuilds",
      );
      if (fs.existsSync(liquidGlassPrebuilds)) {
        const dirs = fs.readdirSync(liquidGlassPrebuilds);
        for (const dir of dirs) {
          if (dir !== platformArch) {
            removeDirRecursive(path.join(liquidGlassPrebuilds, dir));
          }
        }
      }

      // 4. 深度清理 better-sqlite3 — 只保留 build/Release/*.node、lib/、package.json、binding.gyp
      const betterSqlitePath = path.join(nodeModulesPath, "better-sqlite3");
      if (fs.existsSync(betterSqlitePath)) {
        // 删除编译源码和 SQLite 源码
        removeDirRecursive(path.join(betterSqlitePath, "deps"));
        removeDirRecursive(path.join(betterSqlitePath, "src"));
        // 清理 build/ 中除 Release/*.node 以外的所有文件
        const bsBuild = path.join(betterSqlitePath, "build");
        if (fs.existsSync(bsBuild)) {
          const bsEntries = fs.readdirSync(bsBuild);
          for (const entry of bsEntries) {
            if (entry !== "Release") {
              const entryPath = path.join(bsBuild, entry);
              if (fs.statSync(entryPath).isDirectory()) {
                removeDirRecursive(entryPath);
              } else {
                removeFile(entryPath);
              }
            }
          }
          // Release 中只保留 .node 文件
          const bsRelease = path.join(bsBuild, "Release");
          if (fs.existsSync(bsRelease)) {
            walkDir(bsRelease, (fp) => {
              if (!fp.endsWith(".node")) removeFile(fp);
            });
          }
        }
      }

      // 5. 深度清理 node-pty — 按目标平台差分清理
      const nodePtyPath = path.join(nodeModulesPath, "node-pty");
      if (fs.existsSync(nodePtyPath)) {
        // 删除编译源码、winpty deps、scripts、typings、测试文件
        removeDirRecursive(path.join(nodePtyPath, "src"));
        removeDirRecursive(path.join(nodePtyPath, "deps"));
        removeDirRecursive(path.join(nodePtyPath, "scripts"));
        removeDirRecursive(path.join(nodePtyPath, "typings"));

        // third_party/conpty/ — Windows 运行时需要，其他平台全部删除
        const thirdPartyPath = path.join(nodePtyPath, "third_party");
        if (platform === "win32") {
          // Windows：只保留目标架构的 conpty 二进制
          const conptyBase = path.join(
            thirdPartyPath,
            "conpty",
          );
          if (fs.existsSync(conptyBase)) {
            // 遍历版本目录（如 1.23.251008001/）
            for (const ver of fs.readdirSync(conptyBase)) {
              const verPath = path.join(conptyBase, ver);
              if (!fs.statSync(verPath).isDirectory()) continue;
              for (const platDir of fs.readdirSync(verPath)) {
                // 目录格式: win10-x64, win10-arm64
                if (!platDir.includes(arch)) {
                  removeDirRecursive(path.join(verPath, platDir));
                }
              }
            }
          }
        } else {
          // 非 Windows：conpty 完全不需要
          removeDirRecursive(thirdPartyPath);
        }

        // bin/{platform}-{arch}-{abi}/ — 只保留目标平台的 prebuild
        const binPath = path.join(nodePtyPath, "bin");
        if (fs.existsSync(binPath)) {
          for (const dir of fs.readdirSync(binPath)) {
            if (!dir.startsWith(`${platform}-${arch}-`)) {
              removeDirRecursive(path.join(binPath, dir));
            }
          }
        }
        // 清理 build/ 中除 Release/{pty.node, spawn-helper} 以外的所有内容
        const nptBuild = path.join(nodePtyPath, "build");
        if (fs.existsSync(nptBuild)) {
          const nptEntries = fs.readdirSync(nptBuild);
          for (const entry of nptEntries) {
            if (entry !== "Release") {
              const entryPath = path.join(nptBuild, entry);
              if (fs.statSync(entryPath).isDirectory()) {
                removeDirRecursive(entryPath);
              } else {
                removeFile(entryPath);
              }
            }
          }
          // Release 中只保留 pty.node 和 spawn-helper
          const nptRelease = path.join(nptBuild, "Release");
          if (fs.existsSync(nptRelease)) {
            const releaseEntries = fs.readdirSync(nptRelease, {
              withFileTypes: true,
            });
            for (const entry of releaseEntries) {
              const fullPath = path.join(nptRelease, entry.name);
              if (
                entry.name !== "pty.node" &&
                entry.name !== "spawn-helper"
              ) {
                if (entry.isDirectory()) {
                  removeDirRecursive(fullPath);
                } else {
                  removeFile(fullPath);
                }
              }
            }
          }
        }
        // 删除 node_modules/node-pty/node_modules（嵌套的 node-addon-api 构建产物）
        removeDirRecursive(path.join(nodePtyPath, "node_modules"));
        // 删除测试文件
        walkDir(path.join(nodePtyPath, "lib"), (fp) => {
          if (fp.endsWith(".test.js")) removeFile(fp);
        });
      }

      // 6. 清理所有 node_modules 下的非运行时文件
      const junkPatterns = [
        /\.md$/i,
        /LICENSE(\..*)?$/i,
        /LICENCE(\..*)?$/i,
        /CHANGELOG(\..*)?$/i,
        /HISTORY(\..*)?$/i,
        /\.npmignore$/,
        /\.travis\.yml$/,
        /\.eslintrc(\..*)?$/,
        /\.prettierrc(\..*)?$/,
        /\.editorconfig$/,
        /\.jshintrc$/,
        /tsconfig\.json$/,
        /\.github$/,
        /\.gitattributes$/,
        /Makefile$/,
        /Gruntfile\.js$/,
        /Gulpfile\.js$/,
        /\.DS_Store$/,
        /\.map$/,
        /\.ts$/,           // TypeScript 源文件（保留 .d.ts）
        /\.cc$/,           // C++ 源文件
        /\.cpp$/,
        /\.hpp$/,
        /\.h$/,            // C/C++ 头文件
        /\.c$/,            // C 源文件
        /\.o$/,            // 编译中间产物
        /\.gyp$/,          // gyp 构建文件
        /\.gypi$/,
        /\.mk$/,           // Makefile 片段
        /\.stamp$/,        // 构建 stamp
        /\.d$/,            // 依赖跟踪文件
      ];

      let cleanedCount = 0;
      walkDir(nodeModulesPath, (filePath) => {
        const basename = path.basename(filePath);
        // 保留 .d.ts 和 .node 文件
        if (basename.endsWith(".d.ts") || basename.endsWith(".node")) return;
        if (junkPatterns.some((p) => p.test(basename))) {
          fs.unlinkSync(filePath);
          cleanedCount++;
        }
      });

      console.log(
        `   ✅ Cleaned ${cleanedCount} non-runtime files from node_modules`,
      );
    },

    // 打包后复制对应平台的 codex 二进制
    packageAfterCopy: async (config, buildPath, electronVersion, platform, arch) => {
      const runtime = getCodexRuntimeFiles(platform, arch);
      const platformArch = `${platform}-${arch}`;
      const resourcesPath = path.dirname(buildPath);

      console.log(`\n[packageAfterCopy] Packaging for ${platformArch}...`);
      console.log(`   buildPath: ${buildPath}`);

      if (runtime.files.length === 0) {
        const tried = runtime.triedPaths.length
          ? runtime.triedPaths.map((candidate) => `   - ${candidate}`).join("\n")
          : "   - (none)";
        throw new Error(
          [
            `Codex runtime files not found for ${platformArch}.`,
            `Required files: ${runtime.codexName}, ${runtime.rgName}.`,
            "Checked:",
            tried,
          ].join("\n"),
        );
      }

      const filesToCopy = [...new Set(runtime.files)];
      const copiedNames = [];
      for (const sourcePath of filesToCopy) {
        const fileName = path.basename(sourcePath);
        if (fileName === ".codex-stage.json") continue;

        const destinationPath = path.join(resourcesPath, fileName);
        fs.copyFileSync(sourcePath, destinationPath);
        if (platform !== "win32") {
          fs.chmodSync(destinationPath, 0o755);
        }
        copiedNames.push(fileName);
      }

      const codexDest = path.join(resourcesPath, runtime.codexName);
      const rgDest = path.join(resourcesPath, runtime.rgName);
      if (!fs.existsSync(codexDest) || !fs.existsSync(rgDest)) {
        throw new Error(
          [
            `Codex runtime copy verification failed for ${platformArch}.`,
            "Expected destination files:",
            `   - ${codexDest}`,
            `   - ${rgDest}`,
          ].join("\n"),
        );
      }

      console.log(`   Runtime source: ${runtime.sourceDescription}`);
      console.log(`   Copied files: ${copiedNames.join(", ")}`);
    },
  },
};
