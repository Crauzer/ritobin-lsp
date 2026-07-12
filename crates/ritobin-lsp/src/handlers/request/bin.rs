//! Handlers for the custom `ritobin-lsp/deserializeBin` and
//! `ritobin-lsp/serializeBin` requests.
//!
//! Both wrap the blocking conversions in [`bin_io`] and respond via
//! [`Server::respond_blocking`], so these never touch a document worker and
//! the main loop never waits on file IO.

use std::path::Path;
use std::sync::Arc;

use lsp_server::RequestId;
use lsp_types::request::Request as _;

use crate::{
    handlers::bin_io,
    lsp::ext::{DeserializeBin, DeserializeBinParams, SerializeBin, SerializeBinParams},
    server::Server,
};

pub fn handle_deserialize_bin(server: &Arc<Server>, id: RequestId, params: DeserializeBinParams) {
    server.respond_blocking(id, DeserializeBin::METHOD, move || {
        bin_io::deserialize_bin(Path::new(&params.bin_path)).map_err(|e| e.to_string())
    });
}

pub fn handle_serialize_bin(server: &Arc<Server>, id: RequestId, params: SerializeBinParams) {
    server.respond_blocking(id, SerializeBin::METHOD, move || {
        bin_io::serialize_bin(Path::new(&params.bin_path), &params.text).map_err(|e| e.to_string())
    });
}
