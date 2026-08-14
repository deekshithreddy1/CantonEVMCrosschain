import io,json,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"src"))
from interweave import InterWeave,InterWeaveAPIError
class Response:
 def __init__(self,data,status=200):self.data=data;self.status=status;self.headers={"x-test":"yes"}
 def read(self):return json.dumps(self.data).encode()
class Tests(unittest.TestCase):
 def test_routes_auth_and_idempotency(self):
  calls=[]
  def open(req,timeout):calls.append(req);return Response({"data":{"ok":True},"requestId":"r1"})
  iw=InterWeave("secret","http://localhost:1",opener=open,idempotency_key=lambda:"key")
  iw.assets.get("IW:ASSET:bond");iw.transfers.create({"amount":"1"});iw.bridge.move({"amount":"1"});iw.settlement.create({});iw.attestations.request({});iw.transactions.get("IW:TRANSACTION:1")
  self.assertIn("IW%3AASSET%3Abond",calls[0].full_url);self.assertEqual(calls[1].headers["Idempotency-key"],"key");self.assertEqual(calls[1].headers["Authorization"],"Bearer secret")
 def test_raw_metadata_and_security(self):
  iw=InterWeave("x","http://localhost",opener=lambda r,timeout:Response({"data":[],"requestId":"r"}))
  self.assertEqual(iw.raw_request(path="/v1/networks")["metadata"]["request_id"],"r")
  with self.assertRaises(ValueError):InterWeave("x","http://example.com")
 def test_error_semantics(self):
  error=InterWeaveAPIError(503,"DOWN","later","r");self.assertTrue(error.retryable);self.assertEqual(error.code,"DOWN")
if __name__=="__main__":unittest.main()
