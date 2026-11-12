//! DDP (Distributed Display Protocol) v1 encoder and UDP emitter.
//!
//! Header layout (10 bytes), as implemented by WLED on UDP port 4048:
//!
//! | byte | field     | value                                               |
//! |------|-----------|-----------------------------------------------------|
//! | 0    | flags     | 0x40 = version 1, | 0x01 PUSH on the frame's last packet |
//! | 1    | sequence  | low nibble 1..15                                    |
//! | 2    | data type | 0x0B = RGB, 8 bits per element                      |
//! | 3    | dest id   | 0x01 = default output device                        |
//! | 4..8 | offset    | u32 big-endian byte offset into the pixel buffer    |
//! | 8..10| length    | u16 big-endian payload length                       |

use std::io;
use std::net::{SocketAddr, UdpSocket};

pub const HEADER_LEN: usize = 10;
/// 480 RGB pixels per datagram keeps every packet under a 1500-byte Ethernet MTU.
pub const MAX_PAYLOAD: usize = 1440;
pub const FLAG_VER1: u8 = 0x40;
pub const FLAG_PUSH: u8 = 0x01;
pub const TYPE_RGB24: u8 = 0x0B;
pub const ID_DISPLAY: u8 = 0x01;

/// Splits an RGB frame into DDP datagrams. The PUSH flag is set on the last one only,
/// so the receiver latches the whole frame at once.
pub fn encode_frame(rgb: &[u8], sequence: u8) -> Vec<Vec<u8>> {
    let seq = sequence & 0x0F;
    let count = rgb.len().div_ceil(MAX_PAYLOAD).max(1);
    let mut packets = Vec::with_capacity(count);
    for i in 0..count {
        let offset = i * MAX_PAYLOAD;
        let end = (offset + MAX_PAYLOAD).min(rgb.len());
        let chunk = &rgb[offset.min(rgb.len())..end];
        let last = i == count - 1;
        let mut pkt = Vec::with_capacity(HEADER_LEN + chunk.len());
        pkt.push(FLAG_VER1 | if last { FLAG_PUSH } else { 0 });
        pkt.push(seq);
        pkt.push(TYPE_RGB24);
        pkt.push(ID_DISPLAY);
        pkt.extend_from_slice(&(offset as u32).to_be_bytes());
        pkt.extend_from_slice(&(chunk.len() as u16).to_be_bytes());
        pkt.extend_from_slice(chunk);
        packets.push(pkt);
    }
    packets
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SendStats {
    pub packets: usize,
    pub bytes: usize,
}

/// One ephemeral UDP socket shared by every device.
pub struct DdpSender {
    socket: UdpSocket,
}

impl DdpSender {
    pub fn bind() -> io::Result<Self> {
        let socket = UdpSocket::bind("0.0.0.0:0")?;
        socket.set_broadcast(true)?;
        Ok(Self { socket })
    }

    pub fn send_frame(&self, target: SocketAddr, rgb: &[u8], sequence: u8) -> io::Result<SendStats> {
        let mut stats = SendStats { packets: 0, bytes: 0 };
        for pkt in encode_frame(rgb, sequence) {
            stats.bytes += self.socket.send_to(&pkt, target)?;
            stats.packets += 1;
        }
        Ok(stats)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn single_packet_header() {
        let rgb = vec![0xAA; 30];
        let pkts = encode_frame(&rgb, 3);
        assert_eq!(pkts.len(), 1);
        assert_eq!(&pkts[0][..HEADER_LEN], &[0x41, 0x03, 0x0B, 0x01, 0, 0, 0, 0, 0, 30]);
        assert_eq!(pkts[0].len(), HEADER_LEN + 30);
    }

    #[test]
    fn splits_with_offsets_and_push_on_last() {
        let rgb: Vec<u8> = (0..(440 * 3)).map(|i| (i % 251) as u8).collect();
        let pkts = encode_frame(&rgb, 17);
        assert_eq!(pkts.len(), 1); // 1320 bytes fit in one datagram
        let big: Vec<u8> = vec![1; 600 * 3];
        let pkts = encode_frame(&big, 17);
        assert_eq!(pkts.len(), 2);
        assert_eq!(pkts[0][0], FLAG_VER1);
        assert_eq!(pkts[1][0], FLAG_VER1 | FLAG_PUSH);
        assert_eq!(pkts[0][1], 1); // 17 & 0x0F
        assert_eq!(u32::from_be_bytes([pkts[1][4], pkts[1][5], pkts[1][6], pkts[1][7]]), MAX_PAYLOAD as u32);
        assert_eq!(u16::from_be_bytes([pkts[1][8], pkts[1][9]]), (600 * 3 - MAX_PAYLOAD) as u16);
    }

    #[test]
    fn empty_frame_still_pushes() {
        let pkts = encode_frame(&[], 1);
        assert_eq!(pkts.len(), 1);
        assert_eq!(pkts[0].len(), HEADER_LEN);
        assert_eq!(pkts[0][0], FLAG_VER1 | FLAG_PUSH);
    }

    #[test]
    fn loopback_roundtrip() {
        let rx = UdpSocket::bind("127.0.0.1:0").unwrap();
        let tx = DdpSender::bind().unwrap();
        let stats = tx.send_frame(rx.local_addr().unwrap(), &[10, 20, 30], 2).unwrap();
        assert_eq!(
            stats,
            SendStats {
                packets: 1,
                bytes: HEADER_LEN + 3
            }
        );
        let mut buf = [0u8; 64];
        let (n, _) = rx.recv_from(&mut buf).unwrap();
        assert_eq!(&buf[..n], &[0x41, 0x02, 0x0B, 0x01, 0, 0, 0, 0, 0, 3, 10, 20, 30]);
    }
}
