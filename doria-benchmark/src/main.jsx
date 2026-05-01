import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <div style={{ maxWidth: 1280, margin: "24px auto", padding: 12 }}>
      <App />
    </div>
  </React.StrictMode>
);
