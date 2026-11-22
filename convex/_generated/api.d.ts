/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as aiBudget from "../aiBudget.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as lib_analyzer from "../lib/analyzer.js";
import type * as lib_database from "../lib/database.js";
import type * as lib_models from "../lib/models.js";
import type * as lib_queue from "../lib/queue.js";
import type * as lib_runtime from "../lib/runtime.js";
import type * as queue from "../queue.js";
import type * as runtime from "../runtime.js";
import type * as store from "../store.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  aiBudget: typeof aiBudget;
  crons: typeof crons;
  http: typeof http;
  "lib/analyzer": typeof lib_analyzer;
  "lib/database": typeof lib_database;
  "lib/models": typeof lib_models;
  "lib/queue": typeof lib_queue;
  "lib/runtime": typeof lib_runtime;
  queue: typeof queue;
  runtime: typeof runtime;
  store: typeof store;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
