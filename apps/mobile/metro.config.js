const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// Watch shared packages in the monorepo
config.watchFolders = [workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// Required for pnpm + Expo SDK 57 deep imports (e.g. @expo/log-box/src/LogBox)
config.resolver.disableHierarchicalLookup = false;
config.resolver.unstable_enableSymlinks = true;
config.resolver.unstable_enablePackageExports = false;

module.exports = config;
