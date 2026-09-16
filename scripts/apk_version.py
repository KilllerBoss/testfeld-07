#!/usr/bin/env python3
"""Minimal AXML (binary AndroidManifest.xml) parser: extract versionCode/versionName."""
import struct, sys, zipfile

def parse_strings(buf, off):
    # chunk header: type(2) headersize(2) size(4) stringcount(4) stylecount(4) ...
    string_count = struct.unpack_from('<I', buf, off + 8)[0]
    strings_off = struct.unpack_from('<I', buf, off + 20)[0]
    flags = struct.unpack_from('<I', buf, off + 16)[0]
    utf8 = bool(flags & (1 << 8))
    offsets = struct.unpack_from('<%dI' % string_count, buf, off + 28)
    out = []
    base = off + strings_off
    for o in offsets:
        p = base + o
        if utf8:
            # u16len, u8len, bytes, null
            l1 = struct.unpack_from('<H', buf, p)[0]; p += 2
            if l1 & 0x8000: p += 2
            l2 = buf[p]; p += 1
            if l2 & 0x8000: l2 = ((l2 & 0x7F) << 8) | buf[p]; p += 1
            out.append(buf[p:p + l2].decode('utf-8', 'replace'))
        else:
            l = struct.unpack_from('<H', buf, p)[0]; p += 2
            if l & 0x8000: l = ((l & 0x7FFF) << 16) | struct.unpack_from('<H', buf, p)[0]; p += 2
            out.append(buf[p:p + 2 * l].decode('utf-16-le', 'replace'))
    return out

def main(apk):
    z = zipfile.ZipFile(apk)
    data = z.read('AndroidManifest.xml')
    off = 8
    strings = None
    # find string pool chunk + start resource map scan
    while off < len(data) - 8:
        ctype, hsize, size = struct.unpack_from('<HHI', data, off)
        if ctype == 0x0001 and strings is None:  # RES_STRING_POOL_TYPE
            strings = parse_strings(data, off)
        off += size
    if strings is None:
        print('no string pool'); sys.exit(1)
    try:
        i_vc = strings.index('versionCode'); i_vn = strings.index('versionName')
    except ValueError:
        print('attr strings missing'); sys.exit(1)

    # walk start-tag chunks; attribute: ns,name,rawValue: 12 bytes; then typed value: size(2) res0(1) type(1) data(4)
    off = 8
    while off < len(data) - 8:
        ctype, hsize, size = struct.unpack_from('<HHI', data, off)
        if ctype == 0x0102:  # start element
            # after 20-byte header: ns(4) name(4) attrStart(2) attrSize(2) attrCount(2) ...
            hs = hsize
            attr_start = struct.unpack_from('<H', data, off + hs + 8)[0]
            attr_size = struct.unpack_from('<H', data, off + hs + 10)[0]
            attr_count = struct.unpack_from('<H', data, off + hs + 12)[0]
            base = off + hs + attr_start
            for a in range(attr_count):
                p = base + a * attr_size
                name_idx = struct.unpack_from('<I', data, p + 4)[0]
                if name_idx == i_vc or name_idx == i_vn:
                    tv = p + 12  # typed value: size(2) res0(1) dataType(1) data(4)
                    dtype = data[tv + 3]
                    dval = struct.unpack_from('<I', data, tv + 4)[0]
                    if name_idx == i_vc:
                        print('versionCode =', dval)
                    else:
                        s = strings[dval] if dtype == 3 else str(dval)
                        print('versionName =', s)
        off += size

if __name__ == '__main__':
    main(sys.argv[1])
