import { ConfigError, loadConfig } from "@zeno/shared";

try {
  const config = loadConfig();
  console.log(`ZENO Phase 0: started (log level: ${config.log.level})`);
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
