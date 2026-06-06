var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// node_modules/@zakkster/lite-signal/Watch.js
function watch(source, callback, options) {
  const immediate = options !== void 0 && options.immediate === true;
  let oldValue = UNINITIALIZED;
  let currentNewValue;
  let stopFn = null;
  let wantsStopEarly = false;
  const stop = () => {
    if (stopFn !== null) stopFn();
    else wantsStopEarly = true;
  };
  const untrackedFire = () => {
    if (oldValue === UNINITIALIZED) {
      if (immediate) callback(currentNewValue, void 0, stop);
    } else if (!Object.is(currentNewValue, oldValue)) {
      callback(currentNewValue, oldValue, stop);
    }
    oldValue = currentNewValue;
  };
  stopFn = effect(() => {
    currentNewValue = source();
    untrack(untrackedFire);
  });
  if (wantsStopEarly) stopFn();
  return stop;
}
var UNINITIALIZED;
var init_Watch = __esm({
  "node_modules/@zakkster/lite-signal/Watch.js"() {
    init_Signal();
    UNINITIALIZED = /* @__PURE__ */ Symbol("watch.uninitialized");
  }
});

// node_modules/@zakkster/lite-signal/Signal.js
function createRegistry(config = {}) {
  const NODE_PTR = /* @__PURE__ */ Symbol("node_ptr");
  const NODE_GEN = /* @__PURE__ */ Symbol("node_gen");
  let currentNodesCapacity = config.maxNodes ?? 1024;
  let currentLinkCapacity = config.maxLinks ?? currentNodesCapacity * 4;
  const policy = config.onCapacityExceeded ?? "throw";
  const maxFlushPasses = config.maxFlushPasses ?? 100;
  const maxLinkLimit = currentLinkCapacity * 16;
  const nodePool = [];
  for (let i = 0; i < currentNodesCapacity; i++) nodePool[i] = new ReactiveNode();
  let freeNodeHead = nodePool[0];
  for (let i = 0; i < currentNodesCapacity - 1; i++) nodePool[i].nextFree = nodePool[i + 1];
  const linkPool = [];
  for (let i = 0; i < currentLinkCapacity; i++) linkPool[i] = new ReactiveLink();
  let freeLinkHead = linkPool[0];
  for (let i = 0; i < currentLinkCapacity - 1; i++) linkPool[i].nextFree = linkPool[i + 1];
  let activeNodes = 0 | 0;
  let activeLinks = 0 | 0;
  let statSignals = 0 | 0;
  let statComputeds = 0 | 0;
  let statEffects = 0 | 0;
  const effectQueueA = [];
  const effectQueueB = [];
  const markStack = [];
  for (let i = 0; i < currentNodesCapacity; i++) {
    effectQueueA[i] = null;
    effectQueueB[i] = null;
    markStack[i] = null;
  }
  let activeQueue = effectQueueA;
  let activeQueueLen = 0 | 0;
  let isQueueA = true;
  let globalVersion = 1 | 0;
  let batchEpoch = 1 | 0;
  let currentObserver = null;
  let activeObserverCurrentDep = null;
  let batchDepth = 0 | 0;
  let isTrackingDeps = false;
  let isFlushing = false;
  let lifecycleCount = 0 | 0;
  const lifecycleMap = /* @__PURE__ */ new WeakMap();
  function fireConnect(node) {
    const e = lifecycleMap.get(node);
    if (e === void 0 || e.onConnect === void 0) return;
    const po = currentObserver, pt = isTrackingDeps;
    currentObserver = null;
    isTrackingDeps = false;
    try {
      e.onConnect();
    } finally {
      currentObserver = po;
      isTrackingDeps = pt;
    }
  }
  function fireDisconnect(node) {
    const e = lifecycleMap.get(node);
    if (e === void 0 || e.onDisconnect === void 0) return;
    const po = currentObserver, pt = isTrackingDeps;
    currentObserver = null;
    isTrackingDeps = false;
    try {
      e.onDisconnect();
    } finally {
      currentObserver = po;
      isTrackingDeps = pt;
    }
  }
  const flushErrorBuffer = [];
  let flushErrorCount = 0 | 0;
  function allocateLink(source, target) {
    if (target.flags === 0) return null;
    let expected = activeObserverCurrentDep;
    if (expected !== null && expected.source === source) {
      activeObserverCurrentDep = expected.nextDep;
      return expected;
    }
    if (expected !== null) {
      let stale = expected;
      let prev = stale.prevDep;
      if (prev !== null) prev.nextDep = null;
      else target.headDep = null;
      target.tailDep = prev;
      while (stale !== null) {
        let next = stale.nextDep;
        freeLink(stale, target, stale.source);
        stale = next;
      }
      activeObserverCurrentDep = null;
    }
    const lastSub = source.tailSub;
    if (lastSub !== null && lastSub.target === target) return lastSub;
    let link;
    {
      if (freeLinkHead === null) {
        if (policy === "throw") throw new CapacityError("links", currentLinkCapacity);
        const newCap = currentLinkCapacity * 2;
        if (newCap > maxLinkLimit) throw new CapacityError("links", maxLinkLimit);
        const newLinks = new Array(newCap - currentLinkCapacity);
        for (let i = 0; i < newLinks.length; i++) newLinks[i] = new ReactiveLink();
        for (let i = 0; i < newLinks.length - 1; i++) newLinks[i].nextFree = newLinks[i + 1];
        const startIdx = linkPool.length;
        linkPool.length = newCap;
        for (let i = 0; i < newLinks.length; i++) linkPool[startIdx + i] = newLinks[i];
        freeLinkHead = newLinks[0];
        currentLinkCapacity = newCap;
      }
      link = freeLinkHead;
      freeLinkHead = link.nextFree;
      link.nextFree = null;
      activeLinks = activeLinks + 1 | 0;
      link.source = source;
      link.target = target;
      link.nextSub = null;
      link.prevSub = source.tailSub;
      const _was0 = lifecycleCount !== 0 && source.headSub === null;
      if (source.tailSub !== null) source.tailSub.nextSub = link;
      else source.headSub = link;
      source.tailSub = link;
      if (_was0) fireConnect(source);
    }
    let tail = target.tailDep;
    link.prevDep = tail;
    link.nextDep = null;
    if (tail !== null) tail.nextDep = link;
    else target.headDep = link;
    target.tailDep = link;
    return link;
  }
  function freeLink(link, target, source) {
    const pSub = link.prevSub;
    const nSub = link.nextSub;
    if (pSub !== null) pSub.nextSub = nSub;
    else source.headSub = nSub;
    if (nSub !== null) nSub.prevSub = pSub;
    else source.tailSub = pSub;
    if (lifecycleCount !== 0 && source.headSub === null) fireDisconnect(source);
    link.source = null;
    link.target = null;
    link.prevDep = null;
    link.nextDep = null;
    link.prevSub = null;
    link.nextSub = null;
    link.nextFree = freeLinkHead;
    freeLinkHead = link;
    activeLinks = activeLinks - 1 | 0;
  }
  function disposeNode(node) {
    if (node.flags === 0) return;
    runCleanup(node);
    let dLink = node.headDep;
    while (dLink !== null) {
      const next = dLink.nextDep;
      freeLink(dLink, node, dLink.source);
      dLink = next;
    }
    let sLink = node.headSub;
    while (sLink !== null) {
      const target = sLink.target;
      const next = sLink.nextSub;
      const pDep = sLink.prevDep;
      const nDep = sLink.nextDep;
      if (pDep !== null) pDep.nextDep = nDep;
      else target.headDep = nDep;
      if (nDep !== null) nDep.prevDep = pDep;
      else target.tailDep = pDep;
      sLink.source = null;
      sLink.target = null;
      sLink.prevDep = null;
      sLink.nextDep = null;
      sLink.prevSub = null;
      sLink.nextSub = null;
      sLink.nextFree = freeLinkHead;
      freeLinkHead = sLink;
      activeLinks = activeLinks - 1 | 0;
      sLink = next;
    }
    node.computeFn = void 0;
    node.cleanupFn = void 0;
    node.scheduler = void 0;
    node.schedulerThunk = void 0;
    node.value = void 0;
    node.equals = void 0;
    node.flags = 0;
    node.headDep = null;
    node.tailDep = null;
    node.currentDep = null;
    node.headSub = null;
    node.tailSub = null;
    node.revertEpoch = 0;
    node.preBatchValue = void 0;
    node.preBatchVersion = 0;
    node.gen = node.gen + 1 | 0;
    node.nextFree = freeNodeHead;
    freeNodeHead = node;
    activeNodes = activeNodes - 1 | 0;
  }
  function createNode(value, flags) {
    if (freeNodeHead === null) {
      if (policy === "throw") throw new CapacityError("nodes", currentNodesCapacity);
      const newCap = currentNodesCapacity * 2;
      const newNodes = new Array(newCap - currentNodesCapacity);
      for (let i = 0; i < newNodes.length; i++) newNodes[i] = new ReactiveNode();
      for (let i = 0; i < newNodes.length - 1; i++) newNodes[i].nextFree = newNodes[i + 1];
      const startIdx = nodePool.length;
      nodePool.length = newCap;
      for (let i = 0; i < newNodes.length; i++) {
        nodePool[startIdx + i] = newNodes[i];
      }
      freeNodeHead = newNodes[0];
      effectQueueA.length = newCap;
      effectQueueB.length = newCap;
      markStack.length = newCap;
      currentNodesCapacity = newCap;
    }
    const node = freeNodeHead;
    freeNodeHead = node.nextFree;
    node.nextFree = null;
    activeNodes = activeNodes + 1 | 0;
    node.value = value;
    node.flags = flags | 0;
    node.headDep = null;
    node.tailDep = null;
    node.currentDep = null;
    node.headSub = null;
    node.tailSub = null;
    node.version = 0;
    node.evalVersion = 0;
    node.markEpoch = 0;
    node.revertEpoch = 0;
    node.preBatchValue = void 0;
    node.preBatchVersion = 0;
    return node;
  }
  function runCleanup(node) {
    const cleanup = node.cleanupFn;
    if (cleanup === void 0) return;
    const prevObserver = currentObserver;
    const prevTracking = isTrackingDeps;
    currentObserver = null;
    isTrackingDeps = false;
    try {
      if (typeof cleanup === "function") cleanup();
      else for (let i = 0; i < cleanup.length; i++) cleanup[i]();
    } finally {
      node.cleanupFn = void 0;
      currentObserver = prevObserver;
      isTrackingDeps = prevTracking;
    }
  }
  function markDownstream(startNode) {
    let stackLen = 0;
    markStack[stackLen++] = startNode;
    while (stackLen !== 0) {
      const n = markStack[--stackLen];
      let link = n.headSub;
      while (link !== null) {
        const t = link.target;
        if ((t.markEpoch | 0) !== (globalVersion | 0)) {
          t.markEpoch = globalVersion | 0;
          const flags = t.flags | 0;
          if ((flags & FLAG_EFFECT) !== 0) {
            if ((flags & (FLAG_QUEUED | FLAG_COMPUTING)) === 0) {
              t.flags = flags | FLAG_QUEUED;
              activeQueue[activeQueueLen++] = t;
            }
          } else {
            markStack[stackLen++] = t;
          }
        }
        link = link.nextSub;
      }
    }
  }
  function safeExecute(node, gen) {
    if ((node.gen | 0) !== (gen | 0)) return;
    if ((node.flags & FLAG_EFFECT) === 0) return;
    executeEffect(node);
  }
  function flushEffects() {
    if (isFlushing) return;
    isFlushing = true;
    let passes = 0 | 0;
    let normalExit = false;
    try {
      while (activeQueueLen > 0) {
        passes = passes + 1 | 0;
        if (passes > maxFlushPasses) {
          throw new Error("CycleError: flush passes exceeded");
        }
        const toRun = activeQueueLen | 0;
        const currentQueue = activeQueue;
        isQueueA = !isQueueA;
        activeQueue = isQueueA ? effectQueueA : effectQueueB;
        activeQueueLen = 0 | 0;
        for (let i = 0; i < toRun; i++) {
          const node = currentQueue[i];
          try {
            const scheduler = node.scheduler;
            if (scheduler) {
              scheduler(node.schedulerThunk);
            } else {
              executeEffect(node);
            }
          } catch (err) {
            flushErrorBuffer[flushErrorCount] = err;
            flushErrorCount = flushErrorCount + 1 | 0;
          }
        }
      }
      normalExit = true;
    } finally {
      isFlushing = false;
      if (!normalExit) {
        for (let i = 0; i < flushErrorCount; i++) flushErrorBuffer[i] = null;
        flushErrorCount = 0 | 0;
      }
    }
    if (flushErrorCount > 0) {
      if (flushErrorCount === 1) {
        const err = flushErrorBuffer[0];
        flushErrorBuffer[0] = null;
        flushErrorCount = 0 | 0;
        throw err;
      }
      const errs = flushErrorBuffer.slice(0, flushErrorCount);
      for (let i = 0; i < flushErrorCount; i++) flushErrorBuffer[i] = null;
      flushErrorCount = 0 | 0;
      throw new AggregateError(errs, "Effects threw during flush");
    }
  }
  function severTail(node) {
    let stale = activeObserverCurrentDep;
    if (stale !== null) {
      let prev = stale.prevDep;
      if (prev !== null) prev.nextDep = null;
      else node.headDep = null;
      node.tailDep = prev;
      while (stale !== null) {
        let next = stale.nextDep;
        freeLink(stale, node, stale.source);
        stale = next;
      }
    }
  }
  function executeEffect(node) {
    if ((node.flags & FLAG_COMPUTING) !== 0) throw new Error("CycleError: Infinite effect loop detected.");
    const isFirst = node.evalVersion === 0;
    if (!isFirst) {
      let link = node.headDep;
      const evalVer = node.evalVersion | 0;
      let needsRun = false;
      while (link !== null) {
        const dep = link.source;
        if ((dep.flags & FLAG_COMPUTED) !== 0) pullComputed(dep);
        if ((dep.version - evalVer | 0) > 0) {
          needsRun = true;
          break;
        }
        link = link.nextDep;
      }
      if (!needsRun) {
        node.flags = node.flags & ~FLAG_QUEUED;
        node.evalVersion = globalVersion | 0;
        return;
      }
    }
    node.flags = node.flags & ~FLAG_QUEUED | FLAG_COMPUTING;
    runCleanup(node);
    if ((node.flags & FLAG_EFFECT) === 0) return;
    const prevObserver = currentObserver;
    const prevActiveDep = activeObserverCurrentDep;
    const prevTracking = isTrackingDeps;
    currentObserver = node;
    activeObserverCurrentDep = node.headDep;
    isTrackingDeps = true;
    try {
      node.computeFn();
    } finally {
      severTail(node);
      node.currentDep = activeObserverCurrentDep;
      currentObserver = prevObserver;
      activeObserverCurrentDep = prevActiveDep;
      isTrackingDeps = prevTracking;
      node.flags = node.flags & ~FLAG_COMPUTING;
      node.evalVersion = globalVersion | 0;
    }
  }
  function pullComputed(node) {
    if ((node.evalVersion | 0) === (globalVersion | 0)) {
      if ((node.flags & FLAG_HAS_ERROR) !== 0) throw node.value;
      return node.value;
    }
    if (node.evalVersion !== 0 && (node.markEpoch - node.evalVersion | 0) <= 0) {
      node.evalVersion = globalVersion | 0;
      if ((node.flags & FLAG_HAS_ERROR) !== 0) throw node.value;
      return node.value;
    }
    let shouldRun = node.evalVersion === 0;
    if (!shouldRun) {
      let link = node.headDep;
      const evalVer = node.evalVersion | 0;
      while (link !== null) {
        const dep = link.source;
        if ((dep.flags & FLAG_COMPUTED) !== 0) pullComputed(dep);
        if ((dep.version - evalVer | 0) > 0) {
          shouldRun = true;
          break;
        }
        link = link.nextDep;
      }
    }
    if (shouldRun) {
      if ((node.flags & FLAG_COMPUTING) !== 0) throw new Error("CycleError: Circular dependency detected.");
      node.flags = node.flags | FLAG_COMPUTING;
      runCleanup(node);
      const prevObserver = currentObserver;
      const prevActiveDep = activeObserverCurrentDep;
      const prevTracking = isTrackingDeps;
      currentObserver = node;
      activeObserverCurrentDep = node.headDep;
      isTrackingDeps = true;
      try {
        const newValue = node.computeFn();
        const eq = node.equals;
        if (node.evalVersion === 0 || !eq || !eq(node.value, newValue)) {
          node.value = newValue;
          node.version = globalVersion | 0;
        }
        node.flags = node.flags & ~FLAG_HAS_ERROR;
      } catch (err) {
        node.value = err;
        node.flags = node.flags | FLAG_HAS_ERROR;
        node.version = globalVersion | 0;
      } finally {
        severTail(node);
        node.currentDep = activeObserverCurrentDep;
        currentObserver = prevObserver;
        activeObserverCurrentDep = prevActiveDep;
        isTrackingDeps = prevTracking;
        node.flags = node.flags & ~FLAG_COMPUTING;
      }
    }
    node.evalVersion = globalVersion | 0;
    if ((node.flags & FLAG_HAS_ERROR) !== 0) throw node.value;
    return node.value;
  }
  function signal2(initial, opts) {
    const node = createNode(initial, FLAG_SIGNAL);
    node.equals = opts !== void 0 && opts.equals !== void 0 ? opts.equals : Object.is;
    node.version = globalVersion | 0;
    statSignals = statSignals + 1 | 0;
    const read = () => {
      if (isTrackingDeps && currentObserver !== null) {
        const expected = activeObserverCurrentDep;
        if (expected !== null && expected.source === node) {
          activeObserverCurrentDep = expected.nextDep;
        } else {
          allocateLink(node, currentObserver);
        }
      }
      return node.value;
    };
    read.peek = () => node.value;
    read.set = (value) => {
      const eq = node.equals;
      if (eq && eq(node.value, value)) return;
      if (batchDepth > 0 && node.revertEpoch !== batchEpoch) {
        node.preBatchValue = node.value;
        node.preBatchVersion = node.version | 0;
        node.revertEpoch = batchEpoch | 0;
      }
      node.value = value;
      if (batchDepth > 0 && node.revertEpoch === batchEpoch && eq && eq(node.preBatchValue, value)) {
        node.version = node.preBatchVersion | 0;
        return;
      }
      globalVersion = globalVersion + 1 | 0;
      node.version = globalVersion | 0;
      markDownstream(node);
      if (batchDepth === 0) flushEffects();
    };
    read.update = (fn) => read.set(fn(node.value));
    read.subscribe = (fn) => {
      return effect2(() => {
        const val = read();
        const prevTracking = isTrackingDeps;
        isTrackingDeps = false;
        try {
          fn(val);
        } finally {
          isTrackingDeps = prevTracking;
        }
      });
    };
    read[NODE_PTR] = node;
    read[NODE_GEN] = node.gen | 0;
    return read;
  }
  function computed2(fn, opts) {
    const node = createNode(void 0, FLAG_COMPUTED);
    node.computeFn = fn;
    node.equals = opts !== void 0 && opts.equals !== void 0 ? opts.equals : Object.is;
    statComputeds = statComputeds + 1 | 0;
    const read = () => {
      if (isTrackingDeps && currentObserver !== null) {
        const expected = activeObserverCurrentDep;
        if (expected !== null && expected.source === node) {
          activeObserverCurrentDep = expected.nextDep;
        } else {
          allocateLink(node, currentObserver);
        }
      }
      return pullComputed(node);
    };
    read.peek = () => pullComputed(node);
    read.subscribe = (fn2) => {
      return effect2(() => {
        const val = read();
        const prevTracking = isTrackingDeps;
        isTrackingDeps = false;
        try {
          fn2(val);
        } finally {
          isTrackingDeps = prevTracking;
        }
      });
    };
    read[NODE_PTR] = node;
    read[NODE_GEN] = node.gen | 0;
    return read;
  }
  function effect2(fn, opts) {
    const node = createNode(void 0, FLAG_EFFECT);
    node.computeFn = fn;
    const scheduler = opts !== void 0 ? opts.scheduler : void 0;
    node.scheduler = scheduler;
    statEffects = statEffects + 1 | 0;
    let firstRunError = null;
    if (scheduler) {
      const gen = node.gen | 0;
      node.schedulerThunk = () => safeExecute(node, gen);
      scheduler(node.schedulerThunk);
    } else {
      try {
        executeEffect(node);
      } catch (err) {
        firstRunError = err;
      }
    }
    let disposed = false;
    const birthGen = node.gen | 0;
    const disposeFn = function dispose3() {
      if (disposed) return;
      disposed = true;
      if ((node.gen | 0) !== birthGen) return;
      if (node.flags !== 0) {
        disposeNode(node);
        statEffects = statEffects - 1 | 0;
      }
    };
    if (firstRunError !== null) {
      disposeFn();
      throw firstRunError;
    }
    return disposeFn;
  }
  function dispose2(api) {
    const node = api?.[NODE_PTR];
    if (!node) {
      if (typeof api === "function" && typeof api.peek !== "function") api();
      return;
    }
    const stamp = api[NODE_GEN] | 0;
    if (stamp !== (node.gen | 0)) return;
    if (node.flags !== 0) {
      const isSig = (node.flags & FLAG_SIGNAL) !== 0;
      const isComp = (node.flags & FLAG_COMPUTED) !== 0;
      disposeNode(node);
      if (isSig) statSignals = statSignals - 1 | 0;
      if (isComp) statComputeds = statComputeds - 1 | 0;
    }
  }
  function batch2(fn) {
    if (batchDepth === 0) {
      batchEpoch = batchEpoch + 1 | 0;
      if (batchEpoch === 0) batchEpoch = 1 | 0;
    }
    batchDepth = batchDepth + 1 | 0;
    try {
      return fn();
    } finally {
      batchDepth = batchDepth - 1 | 0;
      if (batchDepth === 0) flushEffects();
    }
  }
  function isTracking() {
    return isTrackingDeps && currentObserver !== null;
  }
  function untrack2(fn) {
    const prev = isTrackingDeps;
    isTrackingDeps = false;
    try {
      return fn();
    } finally {
      isTrackingDeps = prev;
    }
  }
  function onCleanup(fn) {
    if (currentObserver !== null) {
      const existing = currentObserver.cleanupFn;
      if (existing === void 0) currentObserver.cleanupFn = fn;
      else if (typeof existing === "function") currentObserver.cleanupFn = [existing, fn];
      else existing.push(fn);
    }
  }
  function stats() {
    return {
      signals: statSignals,
      computeds: statComputeds,
      effects: statEffects,
      activeLinks,
      pooledLinks: currentLinkCapacity - activeLinks,
      linkPoolCapacity: currentLinkCapacity,
      nodePoolCapacity: currentNodesCapacity,
      activeNodes
    };
  }
  function destroy() {
    for (let i = 0; i < currentNodesCapacity; i++) {
      const n = nodePool[i];
      n.value = void 0;
      n.computeFn = void 0;
      n.cleanupFn = void 0;
      n.equals = void 0;
      n.scheduler = void 0;
      n.schedulerThunk = void 0;
      n.flags = 0;
      n.headDep = null;
      n.tailDep = null;
      n.currentDep = null;
      n.headSub = null;
      n.tailSub = null;
      n.version = 0;
      n.evalVersion = 0;
      n.markEpoch = 0;
      n.revertEpoch = 0;
      n.preBatchValue = void 0;
      n.preBatchVersion = 0;
      n.gen = n.gen + 1 | 0;
      if (i < currentNodesCapacity - 1) n.nextFree = nodePool[i + 1];
    }
    nodePool[currentNodesCapacity - 1].nextFree = null;
    freeNodeHead = nodePool[0];
    for (let i = 0; i < currentLinkCapacity; i++) {
      const l = linkPool[i];
      l.source = null;
      l.target = null;
      l.prevDep = null;
      l.nextDep = null;
      l.prevSub = null;
      l.nextSub = null;
      if (i < currentLinkCapacity - 1) l.nextFree = linkPool[i + 1];
    }
    linkPool[currentLinkCapacity - 1].nextFree = null;
    freeLinkHead = linkPool[0];
    activeNodes = 0 | 0;
    activeLinks = 0 | 0;
    activeQueueLen = 0 | 0;
    isFlushing = false;
    batchDepth = 0 | 0;
    currentObserver = null;
    activeObserverCurrentDep = null;
    isTrackingDeps = false;
    globalVersion = 1 | 0;
    batchEpoch = 1 | 0;
    statSignals = 0 | 0;
    statComputeds = 0 | 0;
    statEffects = 0 | 0;
    for (let i = 0; i < flushErrorCount; i++) flushErrorBuffer[i] = null;
    flushErrorCount = 0 | 0;
    flushErrorBuffer.length = 0;
  }
  function hasObservers(handle) {
    const node = handle != null ? handle[NODE_PTR] : void 0;
    return node !== void 0 && node.headSub !== null;
  }
  function observeObservers(handle, opts) {
    const node = handle != null ? handle[NODE_PTR] : void 0;
    if (node === void 0) throw new TypeError("observeObservers: argument is not a reactive handle");
    let e = lifecycleMap.get(node);
    if (e === void 0) {
      e = { onConnect: void 0, onDisconnect: void 0 };
      lifecycleMap.set(node, e);
      lifecycleCount = lifecycleCount + 1 | 0;
    }
    if (opts !== void 0) {
      if (opts.onConnect !== void 0) e.onConnect = opts.onConnect;
      if (opts.onDisconnect !== void 0) e.onDisconnect = opts.onDisconnect;
    }
    let live = true;
    return () => {
      if (!live) return;
      live = false;
      if (lifecycleMap.delete(node)) lifecycleCount = lifecycleCount - 1 | 0;
    };
  }
  function describeNode(node) {
    const fl = node.flags;
    const kind = (fl & FLAG_EFFECT) !== 0 ? "effect" : (fl & FLAG_COMPUTED) !== 0 ? "computed" : "signal";
    return { kind, value: node.value };
  }
  function forEachObserver(handle, fn) {
    const node = handle != null ? handle[NODE_PTR] : void 0;
    if (node === void 0) return;
    let l = node.headSub;
    while (l !== null) {
      const nx = l.nextSub;
      fn(describeNode(l.target));
      l = nx;
    }
  }
  function forEachSource(handle, fn) {
    const node = handle != null ? handle[NODE_PTR] : void 0;
    if (node === void 0) return;
    let l = node.headDep;
    while (l !== null) {
      const nx = l.nextDep;
      fn(describeNode(l.source));
      l = nx;
    }
  }
  return {
    signal: signal2,
    computed: computed2,
    effect: effect2,
    dispose: dispose2,
    batch: batch2,
    untrack: untrack2,
    onCleanup,
    stats,
    destroy,
    isTracking,
    hasObservers,
    observeObservers,
    forEachObserver,
    forEachSource
  };
}
function signal(initial, opts) {
  return defaultRegistry.signal(initial, opts);
}
function computed(fn, opts) {
  return defaultRegistry.computed(fn, opts);
}
function effect(fn, opts) {
  return defaultRegistry.effect(fn, opts);
}
function dispose(api) {
  return defaultRegistry.dispose(api);
}
function batch(fn) {
  return defaultRegistry.batch(fn);
}
function untrack(fn) {
  return defaultRegistry.untrack(fn);
}
var FLAG_COMPUTED, FLAG_EFFECT, FLAG_QUEUED, FLAG_COMPUTING, FLAG_HAS_ERROR, FLAG_SIGNAL, ReactiveNode, ReactiveLink, CapacityError, defaultRegistry;
var init_Signal = __esm({
  "node_modules/@zakkster/lite-signal/Signal.js"() {
    init_Watch();
    FLAG_COMPUTED = 1 << 0;
    FLAG_EFFECT = 1 << 1;
    FLAG_QUEUED = 1 << 2;
    FLAG_COMPUTING = 1 << 3;
    FLAG_HAS_ERROR = 1 << 4;
    FLAG_SIGNAL = 1 << 5;
    ReactiveNode = class {
      constructor() {
        this.flags = 0;
        this.value = void 0;
        this.computeFn = void 0;
        this.cleanupFn = void 0;
        this.equals = void 0;
        this.scheduler = void 0;
        this.version = 0;
        this.evalVersion = 0;
        this.markEpoch = 0;
        this.gen = 0;
        this.preBatchValue = void 0;
        this.preBatchVersion = 0;
        this.revertEpoch = 0;
        this.headDep = null;
        this.tailDep = null;
        this.currentDep = null;
        this.headSub = null;
        this.tailSub = null;
        this.nextFree = null;
        this.schedulerThunk = void 0;
      }
    };
    ReactiveLink = class {
      constructor() {
        this.source = null;
        this.target = null;
        this.prevDep = null;
        this.nextDep = null;
        this.prevSub = null;
        this.nextSub = null;
        this.nextFree = null;
      }
    };
    CapacityError = class extends Error {
      /**
       * @param {"nodes"|"links"} kind  Which pool was exhausted.
       * @param {number}          capacity  Capacity at the time of the error.
       */
      constructor(kind, capacity) {
        super(`CapacityError: ${kind} capacity (${capacity}) exceeded.`);
        this.name = "CapacityError";
        this.kind = kind;
        this.capacity = capacity;
      }
    };
    defaultRegistry = createRegistry();
  }
});

// node_modules/@zakkster/lite-channel/Channel.js
var Channel_exports = {};
__export(Channel_exports, {
  createTabSync: () => createTabSync,
  syncSignal: () => syncSignal
});
function readonly(sig) {
  const r = () => sig();
  r.peek = sig.peek;
  r.subscribe = sig.subscribe;
  return r;
}
function newTabId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}
function createTabSync(channelName, options = {}) {
  const schedule = options.schedule || ((f) => queueMicrotask(f));
  const persist2 = options.persist !== false;
  const heartbeatMs = options.heartbeatMs != null ? options.heartbeatMs : 2e3;
  const evictMs = options.evictMs != null ? options.evictMs : 5e3;
  const readyMs = options.readyMs != null ? options.readyMs : 150;
  const onError = options.onError || ((err) => console.error("lite-channel:", err));
  const BC = globalThis.BroadcastChannel;
  if (typeof BC !== "function") {
    throw new Error("lite-channel: BroadcastChannel is unavailable in this environment");
  }
  const tabId = newTabId();
  const channel = new BC(channelName);
  const hasStorage = persist2 && typeof localStorage !== "undefined";
  const members = signal([tabId]);
  const peers = computed(() => members().length - 1);
  const isLeader = computed(() => members()[0] === tabId);
  const status = signal("connecting");
  const lastSeen = /* @__PURE__ */ new Map();
  function rememberPeer(id) {
    if (id === tabId) return;
    const isNew = !lastSeen.has(id);
    lastSeen.set(id, Date.now());
    if (isNew) {
      const next = members().slice();
      next.push(id);
      next.sort();
      members.set(next);
      post({ t: "join", id: tabId });
    }
  }
  function forgetPeer(id) {
    if (!lastSeen.has(id)) return;
    lastSeen.delete(id);
    members.set(members().filter((m) => m !== id));
  }
  const keys = /* @__PURE__ */ new Map();
  const dirty = /* @__PURE__ */ new Set();
  let pendingFlush = false;
  function post(msg) {
    try {
      channel.postMessage(msg);
    } catch (err) {
      onError(err);
    }
  }
  function storageKey(key) {
    return "lite-channel:" + channelName + ":" + key;
  }
  function persistKey(key, value, clock, writer) {
    if (!hasStorage) return;
    try {
      localStorage.setItem(storageKey(key), JSON.stringify({ value, clock, w: writer }));
    } catch (err) {
      onError(err);
    }
  }
  function scheduleFlush() {
    if (pendingFlush) return;
    pendingFlush = true;
    schedule(flush);
  }
  function flush() {
    pendingFlush = false;
    if (dirty.size === 0) return;
    const updates = [];
    for (const key of dirty) {
      const k = keys.get(key);
      if (!k) continue;
      k.clock += 1;
      k.lastWriter = tabId;
      k.hasState = true;
      const value = k.sig.peek();
      updates.push({ key, value, clock: k.clock, w: tabId });
      persistKey(key, value, k.clock, tabId);
    }
    dirty.clear();
    if (updates.length) post({ t: "state", id: tabId, updates });
  }
  function accept(k, clock, writer) {
    return clock > k.clock || clock === k.clock && writer > k.lastWriter;
  }
  function applyRemote(k, value, clock, writer) {
    k.clock = clock > k.clock ? clock : k.clock;
    k.lastWriter = writer;
    k.hasState = true;
    k.applying = true;
    try {
      k.sig.set(value);
    } finally {
      k.applying = false;
    }
    persistKey(k.key, value, clock, writer);
  }
  function onMessage(ev) {
    const msg = ev.data;
    if (!msg || msg.id === tabId) return;
    rememberPeer(msg.id);
    switch (msg.t) {
      case "join":
        return;
      // presence handled by rememberPeer
      case "leave":
        forgetPeer(msg.id);
        return;
      case "req": {
        if (keys.size === 0) return;
        const updates = [];
        for (const [key, k] of keys) updates.push({ key, value: k.sig.peek(), clock: k.clock, w: k.lastWriter });
        post({ t: "state", id: tabId, snapshot: true, updates });
        return;
      }
      case "state": {
        let applied = false;
        batch(() => {
          for (const u of msg.updates) {
            const k = keys.get(u.key);
            if (!k) continue;
            if (msg.snapshot && !k.hasState || accept(k, u.clock, u.w)) {
              applyRemote(k, u.value, u.clock, u.w);
              applied = true;
            }
          }
        });
        if (applied && status.peek() === "connecting") status.set("synced");
        return;
      }
    }
  }
  channel.addEventListener("message", onMessage);
  post({ t: "join", id: tabId });
  const readyTimer = setTimeout(() => {
    if (status.peek() === "connecting") status.set("synced");
  }, readyMs);
  let hbTimer = null;
  if (heartbeatMs > 0) {
    hbTimer = setInterval(() => {
      post({ t: "join", id: tabId });
      const cutoff = Date.now() - evictMs;
      let changed = false;
      for (const [id, seen] of lastSeen) {
        if (seen < cutoff) {
          lastSeen.delete(id);
          changed = true;
        }
      }
      if (changed) {
        const next = [tabId, ...lastSeen.keys()];
        next.sort();
        members.set(next);
      }
    }, heartbeatMs);
  }
  const onUnload = () => {
    try {
      post({ t: "leave", id: tabId });
    } catch {
    }
  };
  const win = typeof window !== "undefined" && window.addEventListener ? window : null;
  if (win) {
    win.addEventListener("pagehide", onUnload);
    win.addEventListener("beforeunload", onUnload);
  }
  function sync(sig, key = "default") {
    if (keys.has(key)) throw new Error('lite-channel: key "' + key + '" already synced on "' + channelName + '"');
    const k = { key, sig, clock: 0, lastWriter: "", hasState: false, primed: false, applying: false, stopSub: null };
    if (hasStorage) {
      try {
        const raw = localStorage.getItem(storageKey(key));
        if (raw) {
          const snap = JSON.parse(raw);
          k.clock = snap.clock | 0;
          k.lastWriter = snap.w || "";
          k.hasState = true;
          k.applying = true;
          try {
            sig.set(snap.value);
          } finally {
            k.applying = false;
          }
        }
      } catch (err) {
        onError(err);
      }
    }
    k.stopSub = sig.subscribe(() => {
      if (!k.primed) {
        k.primed = true;
        return;
      }
      if (k.applying) return;
      dirty.add(key);
      scheduleFlush();
    });
    keys.set(key, k);
    post({ t: "req", id: tabId });
    return {
      dispose() {
        if (k.stopSub) {
          k.stopSub();
          k.stopSub = null;
        }
        keys.delete(key);
        dirty.delete(key);
      }
    };
  }
  let disposed = false;
  function dispose2() {
    if (disposed) return;
    disposed = true;
    onUnload();
    for (const [, k] of keys) {
      if (k.stopSub) k.stopSub();
    }
    keys.clear();
    dirty.clear();
    clearTimeout(readyTimer);
    if (hbTimer) clearInterval(hbTimer);
    channel.removeEventListener("message", onMessage);
    if (win) {
      win.removeEventListener("pagehide", onUnload);
      win.removeEventListener("beforeunload", onUnload);
    }
    channel.close();
  }
  return {
    channelName,
    tabId,
    sync,
    peers: readonly(peers),
    status: readonly(status),
    isLeader: readonly(isLeader),
    members: readonly(members),
    dispose: dispose2
  };
}
function syncSignal(sig, channelName, options = {}) {
  const tab = createTabSync(channelName, options);
  const handle = tab.sync(sig, "default");
  let disposed = false;
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      handle.dispose();
      tab.dispose();
    },
    peers: tab.peers,
    status: tab.status,
    isLeader: tab.isLeader,
    members: tab.members
  };
}
var init_Channel = __esm({
  "node_modules/@zakkster/lite-channel/Channel.js"() {
    init_Signal();
  }
});

// Auth.js
init_Signal();

// node_modules/@zakkster/lite-persist/Persist.js
init_Signal();

// node_modules/@zakkster/lite-debounce/Debounce.js
init_Signal();

// node_modules/@zakkster/lite-debounce/_shared.js
function makeReadonlyApi(out, dispose2) {
  const api = () => out();
  api.peek = out.peek;
  api.subscribe = out.subscribe;
  api.dispose = dispose2;
  return api;
}

// node_modules/@zakkster/lite-debounce/Debounce.js
function debounce(sourceFn, ms = 0) {
  const out = signal(untrack(sourceFn));
  let timerId = null;
  let microtaskScheduled = false;
  let hasPending = false;
  let pendingValue;
  let lastWriteTime = 0;
  const flush = () => {
    if (ms > 0) {
      const elapsed = performance.now() - lastWriteTime;
      if (elapsed < ms) {
        timerId = setTimeout(flush, ms - elapsed);
        return;
      }
    }
    timerId = null;
    microtaskScheduled = false;
    if (!hasPending) return;
    const v = pendingValue;
    hasPending = false;
    pendingValue = void 0;
    out.set(v);
  };
  const disposeEffect = effect(() => {
    const nextValue = sourceFn();
    const intent = hasPending ? pendingValue : out.peek();
    if (Object.is(nextValue, intent)) return;
    pendingValue = nextValue;
    hasPending = true;
    if (ms === 0) {
      if (!microtaskScheduled) {
        microtaskScheduled = true;
        queueMicrotask(flush);
      }
      return;
    }
    lastWriteTime = performance.now();
    if (timerId === null) {
      timerId = setTimeout(flush, ms);
    }
  });
  return makeReadonlyApi(out, () => {
    if (timerId !== null) clearTimeout(timerId);
    timerId = null;
    microtaskScheduled = false;
    hasPending = false;
    pendingValue = void 0;
    disposeEffect();
  });
}

// node_modules/@zakkster/lite-persist/Persist.js
function persist(sig, key, options = {}) {
  const storage = options.storage || (typeof localStorage !== "undefined" ? localStorage : null);
  if (!storage) {
    console.warn(`[lite-persist] No storage available for key "${key}"; persistence disabled.`);
    return () => {
    };
  }
  const ms = options.debounce !== void 0 ? options.debounce : 50;
  const syncTabs = options.syncTabs !== false;
  const flushOnDispose = options.flushOnDispose === true;
  const serialize = options.serialize || JSON.stringify;
  const deserialize = options.deserialize || JSON.parse;
  let lastSerialized;
  try {
    const stored = storage.getItem(key);
    lastSerialized = stored;
    if (stored !== null) sig.set(deserialize(stored));
  } catch (err) {
    lastSerialized = void 0;
    console.warn(`[lite-persist] Failed to initialize key "${key}":`, err);
  }
  const write = (val) => {
    let s;
    try {
      s = val === void 0 ? null : serialize(val);
    } catch (err) {
      console.warn(`[lite-persist] Failed to serialize key "${key}":`, err);
      return;
    }
    if (s === lastSerialized) return;
    lastSerialized = s;
    try {
      if (s === null) storage.removeItem(key);
      else storage.setItem(key, s);
    } catch (err) {
      console.warn(`[lite-persist] Failed to save key "${key}":`, err);
    }
  };
  const debounced = debounce(sig, ms);
  const stopWatch = watch(debounced, write);
  let onStorage = null;
  if (syncTabs && typeof window !== "undefined") {
    onStorage = (e) => {
      if (e.key !== key || e.storageArea !== storage) return;
      try {
        lastSerialized = e.newValue;
        const nextVal = e.newValue === null ? void 0 : deserialize(e.newValue);
        sig.set(nextVal);
      } catch (err) {
        console.warn(`[lite-persist] Cross-tab sync failed for key "${key}":`, err);
      }
    };
    window.addEventListener("storage", onStorage);
  }
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    stopWatch();
    if (flushOnDispose) write(sig.peek());
    debounced.dispose();
    if (onStorage) window.removeEventListener("storage", onStorage);
  };
}

// Auth.js
var AuthError = class extends Error {
  /**
   * @param {("invalid_credentials"|"network"|"refresh_failed"|"no_refresh_token"|"expired"|"storage"|"aborted"|"misconfigured")} code
   * @param {string} message
   * @param {{ cause?: unknown }} [opts]
   */
  constructor(code, message, opts) {
    super(message);
    this.name = "AuthError";
    this.code = code;
    if (opts && "cause" in opts) this.cause = opts.cause;
  }
};
function toAuthError(err, fallbackCode) {
  if (err instanceof AuthError) return err;
  if (err && (err.name === "AbortError" || err.code === 20)) {
    return new AuthError("aborted", "operation aborted", { cause: err });
  }
  if (err instanceof TypeError) {
    return new AuthError("network", err.message || "network error", { cause: err });
  }
  return new AuthError(fallbackCode, err && err.message ? err.message : String(err), { cause: err });
}
function validateRecord(rec) {
  if (rec == null || typeof rec !== "object") {
    throw new Error("lite-auth: session record must be an object");
  }
  if (rec.user == null) {
    throw new Error("lite-auth: session record is missing `user`");
  }
  if (typeof rec.accessToken !== "string" || rec.accessToken.length === 0) {
    throw new Error("lite-auth: session record is missing a string `accessToken`");
  }
  if (rec.refreshToken != null && typeof rec.refreshToken !== "string") {
    throw new Error("lite-auth: `refreshToken` must be a string when present");
  }
  if (rec.expiresAt != null && typeof rec.expiresAt !== "number") {
    throw new Error("lite-auth: `expiresAt` must be a number (epoch ms) when present");
  }
  return rec;
}
function isExpired(rec, nowMs) {
  return rec != null && rec.expiresAt != null && nowMs >= rec.expiresAt;
}
function decodeJwtExp(token) {
  if (typeof token !== "string") return void 0;
  const dot1 = token.indexOf(".");
  if (dot1 < 0) return void 0;
  const dot2 = token.indexOf(".", dot1 + 1);
  if (dot2 < 0) return void 0;
  let b64 = token.slice(dot1 + 1, dot2).replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - b64.length % 4) % 4;
  if (padLen > 0) b64 += padLen === 1 ? "=" : padLen === 2 ? "==" : "===";
  let json;
  try {
    if (typeof atob === "function") {
      json = atob(b64);
    } else if (typeof Buffer !== "undefined") {
      json = Buffer.from(b64, "base64").toString("binary");
    } else {
      return void 0;
    }
    const payload = JSON.parse(json);
    if (payload && typeof payload.exp === "number") return payload.exp * 1e3;
  } catch {
    return void 0;
  }
  return void 0;
}
function resolveStorage(storage) {
  if (storage === "memory") return null;
  if (storage == null || storage === "localStorage") {
    if (typeof globalThis.localStorage === "undefined") {
      throw new AuthError(
        "misconfigured",
        'localStorage is unavailable; use storage:"memory" outside the browser'
      );
    }
    return globalThis.localStorage;
  }
  if (storage === "sessionStorage") {
    if (typeof globalThis.sessionStorage === "undefined") {
      throw new AuthError(
        "misconfigured",
        'sessionStorage is unavailable; use storage:"memory" outside the browser'
      );
    }
    return globalThis.sessionStorage;
  }
  if (typeof storage.getItem === "function" && typeof storage.setItem === "function") {
    return storage;
  }
  throw new AuthError("misconfigured", "unknown storage backend: " + String(storage));
}
function fetchAdapter(opts) {
  if (!opts || typeof opts.signInUrl !== "string") {
    throw new AuthError("misconfigured", "fetchAdapter requires a signInUrl");
  }
  const f = opts.fetch || globalThis.fetch;
  if (typeof f !== "function") {
    throw new AuthError("misconfigured", "no fetch implementation available");
  }
  const headerOpt = opts.headers;
  const resolveHeaders = () => {
    const dyn = typeof headerOpt === "function" ? headerOpt() : headerOpt;
    return Object.assign({ "content-type": "application/json" }, dyn || {});
  };
  function parse(json) {
    if (opts.parseSession) return validateRecord(opts.parseSession(json));
    const rec = {
      user: json && json.user,
      accessToken: json && json.accessToken,
      refreshToken: json && json.refreshToken,
      expiresAt: json && json.expiresAt
    };
    if (rec.expiresAt == null && typeof rec.accessToken === "string") {
      rec.expiresAt = decodeJwtExp(rec.accessToken);
    }
    return validateRecord(rec);
  }
  const adapter = {
    async signIn(credentials, signal2) {
      const res = await f(opts.signInUrl, {
        method: "POST",
        headers: resolveHeaders(),
        body: JSON.stringify(credentials),
        signal: signal2
      });
      if (!res.ok) {
        throw new AuthError("invalid_credentials", "sign-in failed with status " + res.status);
      }
      return parse(await res.json());
    }
  };
  if (opts.refreshUrl) {
    adapter.refresh = async (record, signal2) => {
      const res = await f(opts.refreshUrl, {
        method: "POST",
        headers: resolveHeaders(),
        body: JSON.stringify({ refreshToken: record.refreshToken }),
        signal: signal2
      });
      if (!res.ok) {
        throw new AuthError("refresh_failed", "token refresh failed with status " + res.status);
      }
      return parse(await res.json());
    };
  }
  if (opts.signOutUrl) {
    adapter.signOut = async (record) => {
      await f(opts.signOutUrl, {
        method: "POST",
        headers: resolveHeaders(),
        body: JSON.stringify({ refreshToken: record.refreshToken })
      });
    };
  }
  return adapter;
}
function createAuth(config) {
  if (!config || !config.adapter || typeof config.adapter.signIn !== "function") {
    throw new AuthError("misconfigured", "createAuth requires an adapter with a signIn() method");
  }
  const adapter = config.adapter;
  const R = config.registry || { signal, computed, batch };
  const storageKey = config.storageKey || "lite-auth.session.v1";
  const channelName = config.channelName || storageKey;
  const crossTab = config.crossTab === true;
  const refreshCfg = config.refresh || { enabled: false };
  const refreshEnabled = refreshCfg.enabled === true;
  const threshold = (typeof refreshCfg.threshold === "number" ? refreshCfg.threshold : 60) * 1e3;
  const onError = typeof config.onError === "function" ? config.onError : null;
  const _record = R.signal(
    /** @type {any} */
    void 0
  );
  const status = R.signal("idle");
  const error = R.signal(
    /** @type {AuthError | null} */
    null
  );
  const session = R.computed(() => {
    const r = _record();
    return r ? r.user : null;
  });
  const isAuthenticated = R.computed(() => _record() != null);
  const token = R.computed(() => {
    const r = _record();
    return r ? r.accessToken : null;
  });
  const expiresAt = R.computed(() => {
    const r = _record();
    return r && r.expiresAt != null ? r.expiresAt : null;
  });
  let gen = 0;
  const disposers = [];
  disposers.push(_record.subscribe(() => {
    gen++;
  }));
  let timer = null;
  let bus = null;
  let busReady = false;
  let refreshAbort = null;
  let signInAbort = null;
  let disposed = false;
  let wireNode = null;
  function setError(err) {
    error.set(err);
    if (onError) {
      try {
        onError(err);
      } catch (e) {
        reportHookError(e);
      }
    }
  }
  function clearError() {
    if (error.peek() !== null) error.set(null);
  }
  const signInCbs = [];
  const signOutCbs = [];
  const expireCbs = [];
  const refreshCbs = [];
  function register(list, fn) {
    list.push(fn);
    let live = true;
    return () => {
      if (!live) return;
      live = false;
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    };
  }
  function reportHookError(e) {
    if (typeof console !== "undefined" && console.error) {
      console.error("lite-auth: lifecycle hook threw", e);
    }
  }
  function emit(list, arg) {
    const copy = list.slice();
    for (let i = 0; i < copy.length; i++) {
      try {
        copy[i](arg);
      } catch (e) {
        reportHookError(e);
      }
    }
  }
  if (config.onSignIn) register(signInCbs, config.onSignIn);
  if (config.onSignOut) register(signOutCbs, config.onSignOut);
  if (config.onSessionExpire) register(expireCbs, config.onSessionExpire);
  if (config.onTokenRefresh) register(refreshCbs, config.onTokenRefresh);
  const backend = resolveStorage(config.storage);
  if (backend) {
    try {
      const raw = backend.getItem(storageKey);
      if (raw !== null) {
        const parsed = JSON.parse(raw);
        if (parsed != null) validateRecord(parsed);
      }
    } catch (e) {
      try {
        backend.removeItem(storageKey);
      } catch {
      }
      setError(new AuthError("storage", "discarded a corrupt stored session", { cause: e }));
    }
    try {
      const stop = persist(_record, storageKey, {
        storage: backend,
        syncTabs: false,
        // lite-channel owns cross-tab
        debounce: 0,
        // session writes are rare; favour durability
        flushOnDispose: true,
        deserialize: (str) => {
          const v = JSON.parse(str);
          return v == null ? void 0 : validateRecord(v);
        }
      });
      disposers.push(stop);
    } catch (e) {
      setError(new AuthError("storage", "failed to initialise persistence", { cause: e }));
    }
  }
  let bootSettled = Promise.resolve();
  {
    const rec0 = _record.peek();
    if (isExpired(rec0, Date.now())) {
      if (refreshEnabled && adapter.refresh && rec0.refreshToken) {
        bootSettled = doRefresh(rec0, false).catch(() => {
        });
      } else {
        emit(expireCbs);
        _record.set(void 0);
      }
    }
  }
  let lifeInit = false;
  let prevHadUser = false;
  disposers.push(_record.subscribe((rec) => {
    const hasUser = rec != null;
    if (!lifeInit) {
      lifeInit = true;
      prevHadUser = hasUser;
      return;
    }
    if (hasUser === prevHadUser) {
      prevHadUser = hasUser;
      return;
    }
    prevHadUser = hasUser;
    if (hasUser) emit(signInCbs, rec.user);
    else emit(signOutCbs);
  }));
  function leaderNow() {
    if (!crossTab) return true;
    if (!busReady || !bus) return false;
    return bus.isLeader.peek();
  }
  function rearm() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (disposed || !refreshEnabled || !adapter.refresh) return;
    const rec = _record.peek();
    if (rec == null || rec.expiresAt == null) return;
    if (!leaderNow()) return;
    const delay = Math.max(0, rec.expiresAt - Date.now() - threshold);
    timer = setTimeout(() => {
      timer = null;
      const r = _record.peek();
      if (r != null) doRefresh(r, false).catch(() => {
      });
    }, delay);
  }
  disposers.push(_record.subscribe(rearm));
  async function doRefresh(rec, manual) {
    if (refreshAbort) refreshAbort.abort();
    refreshAbort = new AbortController();
    const mySignal = refreshAbort.signal;
    const myGen = gen;
    status.set("refreshing");
    let next;
    try {
      if (!adapter.refresh) throw new AuthError("misconfigured", "adapter has no refresh()");
      next = await adapter.refresh(rec, mySignal);
      next = validateRecord(next);
    } catch (e) {
      if (status.peek() === "refreshing") status.set("idle");
      const err = toAuthError(e, "refresh_failed");
      if (mySignal.aborted || gen !== myGen) {
        if (manual) throw err;
        return;
      }
      setError(err);
      emit(expireCbs);
      _record.set(void 0);
      if (manual) throw err;
      return;
    }
    if (mySignal.aborted || gen !== myGen) {
      if (status.peek() === "refreshing") status.set("idle");
      if (manual) throw new AuthError("aborted", "refresh superseded");
      return;
    }
    R.batch(() => {
      clearError();
      _record.set(next);
      status.set("idle");
    });
    emit(refreshCbs, next);
  }
  if (crossTab) {
    const attach = (async () => {
      let mod;
      try {
        mod = await Promise.resolve().then(() => (init_Channel(), Channel_exports));
      } catch (e) {
        setError(new AuthError(
          "misconfigured",
          "crossTab:true requires @zakkster/lite-channel to be installed",
          { cause: e }
        ));
        return;
      }
      if (disposed) return;
      const opts = Object.assign({}, config.channelOptions, { persist: false });
      bus = mod.createTabSync(channelName, opts);
      const EMPTY = "\0";
      const enc = (rec) => rec == null ? EMPTY : JSON.stringify(rec);
      const _wire = R.signal(enc(_record.peek()));
      wireNode = _wire;
      let lastWire = enc(_record.peek());
      disposers.push(_record.subscribe(() => {
        const s = enc(_record.peek());
        if (s === lastWire) return;
        lastWire = s;
        _wire.set(s);
      }));
      disposers.push(_wire.subscribe(() => {
        const s = _wire.peek();
        if (s === lastWire) return;
        lastWire = s;
        let next;
        if (s === EMPTY) {
          next = void 0;
        } else {
          try {
            next = validateRecord(JSON.parse(s));
          } catch {
            return;
          }
        }
        _record.set(next);
      }));
      bus.sync(_wire);
      busReady = true;
      disposers.push(bus.isLeader.subscribe(rearm));
      rearm();
    })();
    bootSettled = bootSettled.then(() => attach);
  }
  const ready = bootSettled.then(() => void 0);
  async function signIn(credentials) {
    if (signInAbort) signInAbort.abort();
    signInAbort = new AbortController();
    const mySignal = signInAbort.signal;
    const myGen = gen;
    status.set("authenticating");
    let rec;
    try {
      rec = await adapter.signIn(credentials, mySignal);
      rec = validateRecord(rec);
    } catch (e) {
      if (status.peek() === "authenticating") status.set("idle");
      const err = toAuthError(e, "invalid_credentials");
      setError(err);
      throw err;
    }
    if (mySignal.aborted || gen !== myGen) {
      if (status.peek() === "authenticating") status.set("idle");
      throw new AuthError("aborted", "sign-in superseded");
    }
    R.batch(() => {
      clearError();
      _record.set(rec);
      status.set("idle");
    });
    return rec.user;
  }
  async function signOut() {
    const rec = _record.peek();
    if (refreshAbort) refreshAbort.abort();
    if (signInAbort) signInAbort.abort();
    R.batch(() => {
      _record.set(void 0);
      status.set("idle");
    });
    if (rec && adapter.signOut) {
      try {
        await adapter.signOut(rec);
      } catch (e) {
        setError(toAuthError(e, "network"));
      }
    }
  }
  async function refresh() {
    const rec = _record.peek();
    if (rec == null) throw new AuthError("expired", "no active session to refresh");
    if (!adapter.refresh) throw new AuthError("misconfigured", "adapter has no refresh()");
    if (rec.refreshToken == null) {
    }
    return doRefresh(rec, true);
  }
  function dispose2() {
    if (disposed) return;
    disposed = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (refreshAbort) refreshAbort.abort();
    if (signInAbort) signInAbort.abort();
    for (let i = 0; i < disposers.length; i++) {
      try {
        disposers[i]();
      } catch {
      }
    }
    disposers.length = 0;
    if (bus) {
      try {
        bus.dispose();
      } catch {
      }
      bus = null;
    }
    const nodes = [session, isAuthenticated, token, expiresAt, _record, status, error];
    if (wireNode) nodes.push(wireNode);
    for (let i = 0; i < nodes.length; i++) {
      try {
        dispose(nodes[i]);
      } catch {
      }
    }
  }
  return {
    session,
    isAuthenticated,
    token,
    expiresAt,
    status,
    error,
    ready,
    signIn,
    signOut,
    refresh,
    onSignIn: (fn) => register(signInCbs, fn),
    onSignOut: (fn) => register(signOutCbs, fn),
    onSessionExpire: (fn) => register(expireCbs, fn),
    onTokenRefresh: (fn) => register(refreshCbs, fn),
    dispose: dispose2
  };
}
export {
  AuthError,
  createAuth,
  decodeJwtExp,
  fetchAdapter
};
