import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { generateExamplesManifest, discoverExamples } from "./generate-examples-manifest.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function getExampleInputs() {
  const examples = discoverExamples();

  const inputs = {
    main: resolve(__dirname, 'examples/index.html'),
  };

  examples.forEach(example => {
    inputs[example.name] = example.path;
  });

  return inputs;
}

function copyManifestToPublic() {
  const manifestPath = resolve(__dirname, "examples", "examples-manifest.json");
  const publicDir = resolve(__dirname, "public");
  const publicManifestPath = resolve(publicDir, "examples-manifest.json");
  if (!existsSync(publicDir)) {
    mkdirSync(publicDir);
  }
  copyFileSync(manifestPath, publicManifestPath);
}

function examplesManifestPlugin() {
  let isExamplesBuild = false;
  let outDir;

  return {
    name: "examples-navigation",
    config(config, { command, mode }) {
      if (command === "build" && mode === "examples") {
        isExamplesBuild = true;
        config.build = config.build || {};
        config.build.rollupOptions = config.build.rollupOptions || {};
        config.build.rollupOptions.input = getExampleInputs();
      }
    },
    configResolved(config) {
      outDir = config.build.outDir;
    },
    buildStart(_options) {
      if (!isExamplesBuild) {
        return;
      }
      generateExamplesManifest();
      copyManifestToPublic();
      console.log("Examples manifest generated and copied to public");
    },
    // Showcase thumbnails aren't imported by any page, so copy them alongside
    // each built example for the docs gallery and sidebar.
    closeBundle() {
      if (!isExamplesBuild) {
        return;
      }
      for (const example of discoverExamples()) {
        const thumbnail = resolve(dirname(example.path), "thumbnail.jpg");
        if (existsSync(thumbnail)) {
          copyFileSync(thumbnail, resolve(outDir, example.name, "thumbnail.jpg"));
        }
      }
    },
    configureServer(server) {
      const regenerateManifest = () => {
        console.log("Regenerating examples manifest...");
        try {
          generateExamplesManifest();
          copyManifestToPublic();
          console.log("Manifest regenerated and copied to public");
        } catch (error) {
          console.error("Failed to regenerate manifest:", error);
        }
      };

      regenerateManifest();

      // watch the entire examples directory for changes (including new files/directories)
      const fileWatcher = server.watcher;
      const examplesDir = resolve(__dirname, "examples");
      const distDir = resolve(__dirname, "examples", "dist");
      fileWatcher.add(examplesDir);

      fileWatcher.on("change", (path) => {
        if (
          path.startsWith(examplesDir) &&
          path.endsWith("index.html") &&
          !path.startsWith(distDir) &&
          !path.endsWith("/examples/index.html") &&
          !path.endsWith("examples-manifest.json")
        ) {
          regenerateManifest();
        }
      });

      fileWatcher.on("add", (path) => {
        if (
          path.startsWith(examplesDir) &&
          path.endsWith("/index.html") &&
          !path.startsWith(distDir) &&
          !path.endsWith("examples-manifest.json")
        ) {
          regenerateManifest();
        }
      });
    },
  };
}

export default examplesManifestPlugin;
