"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Onelo = void 0;
const auth_1 = require("./auth/auth");
class Onelo {
    constructor(config) {
        this.auth = new auth_1.OneloAuth(config);
    }
}
exports.Onelo = Onelo;
//# sourceMappingURL=onelo.js.map