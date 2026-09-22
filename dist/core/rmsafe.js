import fs from "node:fs";
import path from "node:path";
/**
 * 安全删除工具：替代 fs.rmSync。
 *
 * 背景（v0.3.1 修复）：node v24 + Windows 上，fs.rmSync({ force: true }) 对部分
 * 非 ASCII 路径（含 emoji/全角字符的视频文件名）会触发原生 fail-fast
 * （STATUS_STACK_BUFFER_OVERRUN, 0xC0000409）——不可被 try/catch 捕获，
 * 整个进程静默暴毙（无任何报错输出、退出码异常）。实测 fs.unlinkSync /
 * rmdirSync 无此问题，故统一改用「逐项 unlink + rmdir」的删除方式。
 */
/** 删除单个文件；不存在视为已删除 */
export function rmFileSync(p) {
    try {
        fs.unlinkSync(p);
    }
    catch (err) {
        if (err?.code !== "ENOENT")
            throw err;
    }
}
/** 递归删除目录（含内容）；不存在视为已删除。条目一律逐个 unlink，不用 rmSync */
export function rmTreeSync(dir) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    }
    catch (err) {
        if (err?.code === "ENOENT")
            return;
        throw err;
    }
    for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory())
            rmTreeSync(full);
        else
            rmFileSync(full);
    }
    try {
        fs.rmdirSync(dir);
    }
    catch (err) {
        if (err?.code !== "ENOENT")
            throw err;
    }
}
