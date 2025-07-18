"use client"

import React from "react"

let testPromise = Promise.resolve("ok");

export function TestClient() {
  // const data = React.use(props.serverPromise);
  const data = React.use(testPromise);
  console.log("[React.use(props.serverPromise)]", data);
  return <div>[React.use(props.serverPromise): {data}]</div>
}
