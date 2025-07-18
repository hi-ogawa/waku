import { TestClient } from "./client";

const App = () => {
  return (
    <html>
      <head>
        <title>Waku</title>
      </head>
      <body>
        <div>
          {/* <TestClient serverPromise={Promise.resolve("test")}/> */}
          <TestClient />
        </div>
      </body>1
    </html>
  );
};

export default App;
