import json, ssl, uuid
from urllib.parse import quote, urlencode, urlparse
from urllib.request import Request, urlopen
from urllib.error import HTTPError

class InterWeaveAPIError(Exception):
    def __init__(self,status,code,message,request_id=None,details=None): super().__init__(message); self.status=status; self.code=code; self.request_id=request_id; self.details=details
    @property
    def retryable(self): return self.status in (408,429) or self.status>=500

class _Transport:
    def __init__(self,api_key,base_url,timeout,opener,key_factory):
        if not api_key.strip(): raise ValueError("InterWeave api_key is required")
        parsed=urlparse(base_url)
        if parsed.scheme!="https" and not(parsed.scheme=="http" and parsed.hostname in ("localhost","127.0.0.1","::1")): raise ValueError("base_url must use HTTPS except for localhost")
        self.api_key=api_key; self.base_url=base_url.rstrip("/"); self.timeout=timeout; self.opener=opener; self.key_factory=key_factory
    def request(self,path,method="GET",body=None,query=None,idempotency_key=None,raw=False):
        url=self.base_url+path+("?"+urlencode({k:v for k,v in (query or {}).items() if v is not None}) if query else "")
        headers={"Accept":"application/json","Authorization":f"Bearer {self.api_key}"}; data=None
        if body is not None: data=json.dumps(body,separators=(",",":")).encode(); headers["Content-Type"]="application/json"
        if method=="POST": headers["Idempotency-Key"]=idempotency_key or self.key_factory()
        try: response=self.opener(Request(url,data=data,headers=headers,method=method),timeout=self.timeout); status=response.status; payload=json.loads(response.read())
        except HTTPError as error:
            payload=json.loads(error.read() or b"{}"); detail=payload.get("error",{}); raise InterWeaveAPIError(error.code,detail.get("code","HTTP_ERROR"),detail.get("message",str(error)),detail.get("requestId"),detail.get("details")) from None
        if "data" not in payload: raise InterWeaveAPIError(status,"INVALID_RESPONSE","InterWeave API returned an invalid response")
        return {"data":payload["data"],"metadata":{"request_id":payload.get("requestId"),"status":status,"headers":dict(response.headers)}} if raw else payload["data"]

class _Resource:
    def __init__(self,t): self.t=t
class Assets(_Resource):
    def get(self,id): return self.t.request(f"/v1/assets/{quote(id,safe='')}")
    def balance(self,id,**filters): return self.t.request(f"/v1/assets/{quote(id,safe='')}/balances",query=filters)
    def create(self,value,idempotency_key=None): return self.t.request("/v1/assets","POST",value,idempotency_key=idempotency_key)
class Transfers(_Resource):
    def create(self,value,idempotency_key=None): return self.t.request("/v1/transfers","POST",value,idempotency_key=idempotency_key)
    def get(self,id): return self.t.request(f"/v1/transfers/{quote(id,safe='')}")
class Bridge(_Resource):
    def move(self,value,idempotency_key=None): return self.t.request("/v1/bridge/transfers","POST",value,idempotency_key=idempotency_key)
    def get(self,id): return self.t.request(f"/v1/bridge/transfers/{quote(id,safe='')}")
class Settlement(_Resource):
    def create(self,value,idempotency_key=None): return self.t.request("/v1/settlements","POST",value,idempotency_key=idempotency_key)
    def get(self,id): return self.t.request(f"/v1/settlements/{quote(id,safe='')}")
class Attestations(_Resource):
    def request(self,value,idempotency_key=None): return self.t.request("/v1/attestations","POST",value,idempotency_key=idempotency_key)
    def get(self,id): return self.t.request(f"/v1/attestations/{quote(id,safe='')}")
class Transactions(_Resource):
    def get(self,id): return self.t.request(f"/v1/transactions/{quote(id,safe='')}")
class InterWeave:
    def __init__(self,api_key,base_url="https://api.interweave.dev",timeout=30,opener=urlopen,idempotency_key=lambda:str(uuid.uuid4())):
        self._transport=_Transport(api_key,base_url,timeout,opener,idempotency_key); self.assets=Assets(self._transport);self.transfers=Transfers(self._transport);self.bridge=Bridge(self._transport);self.settlement=Settlement(self._transport);self.attestations=Attestations(self._transport);self.transactions=Transactions(self._transport)
    def raw_request(self,**kwargs): return self._transport.request(raw=True,**kwargs)
