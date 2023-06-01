"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decodeName = exports.encodeName = exports.MAX_NAME_LENGTH = void 0;
exports.MAX_NAME_LENGTH = 32;
function encodeName(name) {
    if (name.length > exports.MAX_NAME_LENGTH) {
        throw Error(`Name (${name}) longer than 32 characters`);
    }
    const buffer = Buffer.alloc(32);
    buffer.fill(name);
    buffer.fill(' ', name.length);
    return Array(...buffer);
}
exports.encodeName = encodeName;
function decodeName(bytes) {
    const buffer = Buffer.from(bytes);
    return buffer.toString('utf8').trim();
}
exports.decodeName = decodeName;
