#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args().any(|argument| argument == "--mcp-stdio-bridge") {
        std::process::exit(aquilum_app_lib::run_mcp_stdio_bridge());
    }
    if std::env::args().any(|argument| argument == "--mcp-stdio") {
        std::process::exit(aquilum_app_lib::run_mcp_stdio_headless());
    }
    aquilum_app_lib::run()
}
