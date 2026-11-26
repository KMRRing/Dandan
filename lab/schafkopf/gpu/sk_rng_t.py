"""Counter-based random numbers for the GPU engine (Fable, 26 Nov 12:55Z: seedable, so a position can be re-searched identically
on CPU and GPU). Every draw is a hash of a key and a counter, so what a position gets doesn't depend on the batch it's in or the
device. Keys and values are 32-bit, kept in int64 so products never overflow."""
import torch

M32 = 0xFFFFFFFF


def h32(x):
    x = x & M32
    x = ((x >> 16) ^ x) * 0x45D9F3B & M32
    x = ((x >> 16) ^ x) * 0x45D9F3B & M32
    return (x >> 16) ^ x


def mix(a, b):
    """A key from a key and a number (tensors or ints)."""
    return h32(h32(torch.as_tensor(a, dtype=torch.long)) ^ (torch.as_tensor(b, dtype=torch.long) * 0x9E3779B1 & M32))


def uniform(keys, n, stream):
    """[len(keys), n] uniforms in (0, 1), from keys [M] and a stream number."""
    k = mix(keys, stream)[:, None]
    c = torch.arange(n, device=keys.device, dtype=torch.long)[None, :]
    return (h32(k ^ (c * 0x85EBCA6B & M32)) .double() + 0.5) / 4294967296.0
