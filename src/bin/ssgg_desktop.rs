//! Independent desktop audio service; never starts the legacy GG audio loop.
#[cfg(unix)]
fn main() -> anyhow::Result<()> {
    use anyhow::{Context, anyhow};
    use clap::Parser;
    use std::path::PathBuf;
    use steelseries_gg::desktop::{Service, pulse::PulseBackend, rpc};
    #[derive(Parser)]
    #[command(name = "ssgg-desktop", about = "Private desktop audio RPC service (requires pactl)")]
    struct Args {
        #[arg(long)]
        stdio: bool,
        #[arg(long)]
        safe_mode: bool,
        #[arg(long)]
        socket: Option<PathBuf>,
        #[arg(long)]
        config: Option<PathBuf>,
    }
    let args = Args::parse();
    let config = match args.config {
        Some(path) => path,
        None => std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
            .ok_or_else(|| anyhow!("HOME or XDG_CONFIG_HOME required"))?
            .join("ssgg-desktop/state.json"),
    };
    let mut service = Service::new(PulseBackend::default(), config).map_err(|e| anyhow!(e))?;
    service.set_read_only(args.safe_mode);
    let (client, join) = rpc::worker(service);
    if args.stdio {
        let result = rpc::serve_lines(&mut std::io::stdin().lock(), &mut std::io::stdout().lock(), |value| {
            client.request(value)
        });
        drop(client);
        join.join().map_err(|_| anyhow!("desktop worker failed"))?;
        result.context("stdio RPC")?;
    } else {
        let socket = match args.socket {
            Some(path) => path,
            None => PathBuf::from(
                std::env::var_os("XDG_RUNTIME_DIR")
                    .ok_or_else(|| anyhow!("XDG_RUNTIME_DIR required; use --stdio or --socket"))?,
            )
            .join("ssgg-desktop/service.sock"),
        };
        rpc::serve_socket(&socket, client).context("private desktop socket")?;
    }
    Ok(())
}
#[cfg(not(unix))]
fn main() -> anyhow::Result<()> {
    anyhow::bail!("ssgg-desktop audio service currently requires Linux/Unix")
}
