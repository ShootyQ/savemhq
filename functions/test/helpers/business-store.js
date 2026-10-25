// Transactional in-memory test double: atomic commits, rollback on throw, serial isolation.
class Store {
  constructor() { this.rows = new Map(); this.queue = Promise.resolve(); }
  collection(path) { return new Ref(this,path); }
  async runTransaction(callback) {
    const run = this.queue.then(async () => {
      const writes = [];
      let wrote = false;
      const result = await callback({
        get: async ref => { if (wrote) throw new Error('Firestore reads must precede writes'); return ref.snapshot(); },
        set: (ref,data) => { wrote = true; writes.push([ref.path,structuredClone(data)]); },
      });
      for (const [path,data] of writes) this.rows.set(path,data);
      return result;
    });
    this.queue = run.catch(() => {});
    return run;
  }
  seed(path,data) { this.rows.set(path,structuredClone(data)); }
  read(path) { return this.rows.get(path); }
}
class Ref {
  constructor(db,path,filters = []) { this.db=db;this.path=path;this.id=path.split('/').at(-1);this.filters=filters; }
  doc(id) { return new Ref(this.db,`${this.path}/${id}`); }
  collection(id) { return new Ref(this.db,`${this.path}/${id}`); }
  where(key,op,value) { if(op!=='==')throw new Error('Unsupported operator');return new Ref(this.db,this.path,[...this.filters,[key,value]]); }
  snapshot() {
    if(this.path.split('/').length % 2 === 0){const data=this.db.rows.get(this.path);return{id:this.id,exists:Boolean(data),data:()=>structuredClone(data)};}
    const docs=[...this.db.rows].filter(([path,data])=>path.startsWith(this.path+'/')&&path.split('/').length===this.path.split('/').length+1&&this.filters.every(([key,value])=>data[key]===value)).map(([path,data])=>({id:path.split('/').at(-1),data:()=>structuredClone(data)}));
    return {docs,size:docs.length};
  }
}
module.exports = { Store };
