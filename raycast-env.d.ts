/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `heat-check` command */
  export type HeatCheck = ExtensionPreferences & {}
  /** Preferences accessible in the `diagnosis` command */
  export type Diagnosis = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `heat-check` command */
  export type HeatCheck = {}
  /** Arguments passed to the `diagnosis` command */
  export type Diagnosis = {}
}

