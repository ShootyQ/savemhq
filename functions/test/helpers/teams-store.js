const { Store } = require("./business-store");
// Test transport store only. Production transaction behavior is covered by emulator tests.
class TeamsStore extends Store {
  doc(path) {
    return this.collection(path);
  }
  async runTransaction(callback) {
    const run = this.queue.then(async () => {
      const writes = [];
      let writing = false;
      const result = await callback({
        get: async (ref) => {
          if (writing) throw Error("Reads must precede writes");
          return ref.snapshot();
        },
        set: (ref, data, options) => {
          writing = true;
          writes.push(() =>
            this.rows.set(
              ref.path,
              structuredClone(
                options?.merge ? { ...this.rows.get(ref.path), ...data } : data,
              ),
            ),
          );
        },
        delete: (ref) => {
          writing = true;
          writes.push(() => this.rows.delete(ref.path));
        },
      });
      writes.forEach((write) => write());
      return result;
    });
    this.queue = run.catch(() => {});
    return run;
  }
}
module.exports = { TeamsStore };
