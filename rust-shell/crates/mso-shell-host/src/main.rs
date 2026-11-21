use mso_shell_core::assets::AssetRoot;
use mso_shell_core::managed::ManagedHostConfig;
use mso_shell_core::origin::parse_loopback_origin;
use mso_shell_core::server::{start_loopback_server, ServerConfig};
use std::env;
use std::io::{self, Write};
use std::process;
use std::thread;
use std::time::Duration;

fn usage() -> ! {
    eprintln!(
        "Usage: mso-shell-host [--assets <dir>] [--port <u16>] [--api-origin <loopback-url>] [--managed-host-template <tpl>]\n\
         Defaults: --assets frontend/svelte/build --port 4174 (env: MSO_SVELTE_API_ORIGIN, NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE)"
    );
    process::exit(2);
}

fn main() {
    let mut assets_dir = String::from("frontend/svelte/build");
    let mut port: u16 = 4174;
    let mut api_origin_raw = env::var("MSO_SVELTE_API_ORIGIN").ok().filter(|v| !v.is_empty());
    let mut managed_host_template = env::var("NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE")
        .ok()
        .filter(|v| !v.is_empty());

    let mut args = env::args().skip(1);
    while let Some(flag) = args.next() {
        match flag.as_str() {
            "--assets" => assets_dir = args.next().unwrap_or_else(|| usage()),
            "--port" => {
                let raw = args.next().unwrap_or_else(|| usage());
                port = raw.parse().unwrap_or_else(|_| {
                    eprintln!("mso-shell-host: invalid --port '{raw}'");
                    process::exit(2);
                });
            }
            "--api-origin" => api_origin_raw = Some(args.next().unwrap_or_else(|| usage())),
            "--managed-host-template" => {
                managed_host_template = Some(args.next().unwrap_or_else(|| usage()));
            }
            "-h" | "--help" => usage(),
            other => {
                eprintln!("mso-shell-host: unknown argument '{other}'");
                usage();
            }
        }
    }

    let assets = AssetRoot::open(&assets_dir).unwrap_or_else(|err| {
        eprintln!("mso-shell-host: cannot open assets dir '{assets_dir}': {err}");
        process::exit(1);
    });
    let api_origin = api_origin_raw.map(|raw| {
        parse_loopback_origin(&raw).unwrap_or_else(|err| {
            eprintln!("mso-shell-host: invalid loopback API origin '{raw}': {err}");
            process::exit(2);
        })
    });
    let managed_hosts = ManagedHostConfig::from_template(managed_host_template.as_deref());

    let server = start_loopback_server(ServerConfig {
        port,
        assets,
        api_origin,
        managed_hosts,
    })
    .unwrap_or_else(|err| {
        eprintln!("mso-shell-host: bind failed on 127.0.0.1:{port}: {err}");
        process::exit(1);
    });

    println!("MSO_RUST_SHELL_READY http://{}", server.addr());
    let _ = io::stdout().flush();

    loop {
        thread::sleep(Duration::from_secs(60));
    }
}
