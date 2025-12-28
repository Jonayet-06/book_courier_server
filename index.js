const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET);

const port = process.env.PORT || 3000;
const generateTrackingId = () => {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const time = Date.now().toString().slice(-6);
  const random = Math.floor(1000 + Math.random() * 9000);

  return `TRK-${date}-${time}-${random}`;
};

const trackingId = generateTrackingId();

// console.log(generateTransactionId());
// TXN-LQ7K9V-8F3A2C

// middleware
app.use(express.json());
app.use(cors());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.u65jfbo.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();

    const db = client.db("book_courier_client");
    const booksCollection = db.collection("books");
    const ordersCollection = db.collection("orders");
    const paymentsCollection = db.collection("payments");

    // books api
    app.get("/books", async (req, res) => {
      const result = await booksCollection.find().toArray();
      res.send(result);
    });

    // get single book
    app.get("/books/:id", async (req, res) => {
      const id = req.params.id;
      const result = await booksCollection.findOne({ _id: id });
      res.send(result);
    });

    // orders api
    app.get("/orders", async (req, res) => {
      const query = {};
      const { email } = req.query;
      if (email) {
        query.email = email;
      }
      const result = await ordersCollection.find(query).toArray();
      res.send(result);
    });

    app.get("/orders/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await ordersCollection.findOne(query);
      res.send(result);
    });

    app.post("/orders", async (req, res) => {
      const order = req.body;
      const newOrder = {
        ...order,
        status: "pending",
        paymentStatus: "unpaid",
        createdAt: new Date(),
      };
      const result = await ordersCollection.insertOne(newOrder);
      res.send(result);
    });

    app.delete("/orders/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      const result = await ordersCollection.deleteOne(query);
      res.send(result);
    });

    // payment related apis
    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "USD",
              unit_amount: parseInt(paymentInfo.bookPrice * 100),
              product_data: {
                name: paymentInfo.bookName,
              },
            },
            quantity: 1,
          },
        ],
        customer_email: paymentInfo.email,
        mode: "payment",
        metadata: {
          bookId: paymentInfo.bookId,
          orderId: paymentInfo.orderId,
          bookName: paymentInfo.bookName,
          orderDate: paymentInfo.orderDate,
        },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      });

      console.log(session);
      res.send({ url: session.url });
    });

    app.patch("/payment-success", async (req, res) => {
      const sessionId = req.query.session_id;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      // console.log("session retrieve", session.metadata);

      const transactionId = session.payment_intent;
      const query = { transactionId: transactionId };

      const paymentExist = await paymentsCollection.findOne(query);
      console.log(paymentExist);
      if (paymentExist) {
        return res.send({
          message: "Already Exists",
          transactionId,
          trackingId: paymentExist.trackingId,
        });
      }

      const trackingId = generateTrackingId();
      if (session.payment_status === "paid") {
        // console.log("session retrieve", session.metadata);
        // console.log(session);
        const id = session.metadata.orderId;
        const query = { _id: new ObjectId(id) };
        const update = {
          $set: {
            status: "paid",
            trackingId: trackingId,
          },
        };
        const result = await ordersCollection.updateOne(query, update);
        // console.log(result);

        const payment = {
          amount: session.amount_total / 100,
          currency: session.currency,
          customerEmail: session.customer_email,
          bookId: session.metadata.bookId,
          bookName: session.metadata.bookName,
          transactionId: session.payment_intent,
          paymentStatus: session.payment_status,
          paidAt: new Date(),
          trackingId: trackingId,
        };

        if (session.payment_status === "paid") {
          const resultPayment = await paymentsCollection.insertOne(payment);
          res.send({
            success: true,
            modifyOrder: result,
            trackingId: trackingId,
            transactionId: session.payment_intent,
            paymentInfo: resultPayment,
          });
        }
      }
    });

    // payments related apis
    app.get("/payments", async (req, res) => {
      const email = req.query.email;
      const query = {};
      if (email) {
        query.customerEmail = email;
      }
      const result = await paymentsCollection.find(query).toArray();
      res.send(result);
    });
    app.patch("/orders/cancel/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const update = {
        $set: {
          status: "cancelled",
        },
      };
      const result = await ordersCollection.updateOne(query, update);
      res.send(result);
    });

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("book courier is running...");
});

app.listen(port, () => {
  console.log(`book courier is listening on port ${port}`);
});
