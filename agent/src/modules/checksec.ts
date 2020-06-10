import { dictFromPlistCharArray } from '../lib/dict'
import { encryptionInfo, pie } from '../lib/macho'


export default function checksec(name?: string) {
  let mod: Module
  if (name) {
    const m = Process.findModuleByName(name)
    if (!m) throw Error(`${name} not found`)
    mod = m
  } else {
    mod = Process.enumerateModules()[0]
  }

  const imports = new Set(mod.enumerateImports().map(i => i.name))
  const result = {
    pie: pie(mod),
    encrypted: !encryptionInfo(mod).ptr.isNull(),
    canary: imports.has('__stack_chk_guard'),
    arc: imports.has('objc_release'),
    entitlements: {}
  }

  const CS_OPS_ENTITLEMENTS_BLOB = 7
  const csops = new SystemFunction(
    Module.findExportByName('libsystem_kernel.dylib', 'csops')!,
    'int',
    ['int', 'int', 'pointer', 'ulong']
  )

  // todo: determine CPU endianness
  const ntohl = (val: number) => ((val & 0xFF) << 24)
    | ((val & 0xFF00) << 8)
    | ((val >> 8) & 0xFF00)
    | ((val >> 24) & 0xFF);

  // struct csheader {
  //   uint32_t magic;
  //   uint32_t length;
  // };

  const SIZE_OF_CSHEADER = 8
  const ERANGE = 34
  const csheader = Memory.alloc(SIZE_OF_CSHEADER)
  const { value, errno } = csops(Process.id, CS_OPS_ENTITLEMENTS_BLOB, csheader, SIZE_OF_CSHEADER) as UnixSystemFunctionResult
  if (value === -1 && errno === ERANGE) {
    const length = ntohl(csheader.add(4).readU32())
    const content = Memory.alloc(length)
    if (csops(Process.id, CS_OPS_ENTITLEMENTS_BLOB, content, length).value === 0) {
      result.entitlements = dictFromPlistCharArray(
        content.add(SIZE_OF_CSHEADER), length - SIZE_OF_CSHEADER
      )
    }
  }

  return result
}
