//! Pipeline 运行时

use framing::Framer;
use tokio::sync::mpsc;

pub struct PipelineRuntime {
    input_tx: mpsc::Sender<framing::RawChunk>,
    cancel: tokio_util::sync::CancellationToken,
}

// Note: tokio_util not in deps, keep this as a placeholder
