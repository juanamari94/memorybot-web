const express = require('express');
const bodyParser= require('body-parser');
const app = express();
const mongoose = require('mongoose');
const utils = require('./utils/utils.js');
const secrets = require('./secrets/secrets.js');
const Group = require('./models/Group');
const redis = require('redis');
const cors = require('cors');

app.use(cors());
app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());
mongoose.connect(secrets.MONGO_URI);

const redis_client = redis.createClient(secrets.REDIS_PORT, secrets.REDIS_HOST);

redis_client.auth(secrets.REDIS_PASSWORD, function (err) {
  if (err) throw err;
});

redis_client.on('connect', function() {
  console.log('Connected to Redis');
});


const db = mongoose.connection;

let token_dict = {};

db.on('error', console.error.bind('connection error:'));

db.on('open', () => {
  
  app.listen(3000, () => {
    console.log("Listening on port 3000");
  });
});

app.get('/', (req, res) => {
  
  return res.status(200).send("Index");
});

app.all('/api/token', (req, res, next) => {

  if (req.headers.api_key != secrets.API_KEY) {
    
    return res.status(401).send("Invalid API Key.");
  } else {

    next();
  }
});

app.get('/api/token/:group_id', (req, res) => {

  let group_id = req.params.group_id;

  redis_client.get(group_id, (err, token_reply) => {
    if (err) {

      console.error(err)
      return res.status(500).send();
    } else {

      return res.status(200).send(token_reply);
    }
  });
});

app.post('/api/token', (req, res) => {

  if (req.body.group_id == undefined) {
    return res.status(400).send();
  }

  const group_id = req.body.group_id;

  let group_token = utils.hashKey(group_id + Math.random());

  const group = Group({
    group_id: group_id,
    keyword_map: []
  });

  group.save().then(() => {
  
    redis_client.set(group_id, group_token, (err, token_reply) => {
      
      if (err) {
  
        console.error(err);
        return res.status(500).send();
      } else {

        return res.status(200).send();
      }
    });
  }).catch((err) => {

    console.error(err.message);
    return res.status(403).send("Group already exists.");
  });
});

app.put('/api/token/:group_id', (req, res) => {
  
  const group_id = req.params.group_id;

  redis_client.get(group_id, (err, token_reply) => {

    if (err) {

      console.error(err)
      return res.status(500).send();
    } else {

      const group_token = utils.hashKey(group_id + Math.random());

      redis_client.set(group_id, group_token, (err, set_reply) => {
        
        if (err) {

          console.error(err)
          return res.status(500).send();
        } else {

          return res.status(200).send(group_token);
        } 
      });
    }
  });
});

app.all('/api/keywords/:group_id/:token*', (req, res, next) => {

  if (req.params.token == undefined) {

    return res.status(400).send();
  }

  redis_client.get(req.params.group_id, (err, token_reply) => {

    if (err) {
      
      console.error(err)
      return res.status(500).send();
    } else {

      if (req.params.token == token_reply) {

        next();
      } else {

        res.status(401).send();
      }
    }
  });
});

app.get('/api/keywords/:group_id/:token', (req, res) => {

  Group.findOne({group_id: req.params.group_id}).then(group => {

    return res.status(200).send(group.keyword_map);
  }).catch(err => {

    console.error(err.message);
    return res.status(500).send();
  });
});

app.post('/api/keywords/:group_id/:token', (req, res) => {

  if (!req.body.keyword || !req.body.value) {

    return res.status(400).send();
  }

  let key_value = {"keyword": req.body.keyword, "value": req.body.value};

  Group.findOne({group_id: req.params.group_id})
  .then((group) => {

    if (group.keyword_map == undefined) {

      const group_query = Group({
        group_id: group.group_id,
        keyword_map: [
          key_value
        ]
      });

      group_query.save().then(() => {

        return res.status(200).send({response: "SUCCESS"});
      }).catch((err) => {

        console.error(err.message);
        return res.status(500).send();
      });
    } else {

      if (group.keyword_map.find((entry) => entry.keyword == key_value.keyword) == undefined) {
        
        group.keyword_map.push(key_value);
        
          group.save().then(() => {
    
            return res.status(200).send({response: "SUCCESS"});
          }).catch((err) => {
    
            console.error(err.message);
            return res.status(500).send();
          });
        } else {
        
          return res.status(403).send("Keyword already exists");
        }
      }

  }).catch((err) => {

    console.error(err);
    return res.status(404).send();
  });
});

app.get('/api/keywords/:group_id/:token/:keyword', (req, res) => {
  
  const group_id = req.params.group_id;
  const requested_keyword = req.params.keyword;

  Group.findOne({group_id: group_id}).then(group => {

    const entry = group.keyword_map.find((entry) => entry.keyword == requested_keyword);

    if (entry != undefined) {

      return res.status(200).send(entry.value);
    } else {

      return res.status(404).send();
    }
  }).catch(err => {

    console.error(err.message);
    return res.status(500).send();
  });
});

app.put('/api/keywords/:group_id/:token', (req, res) => {

  if (!req.body.keyword || !req.body.value) {
    return res.status(400).send();
  }

  const updated_entry = {"keyword": req.body.keyword, "value": req.body.value};
  
  Group.findOne({group_id: req.params.group_id})
  .then(group => {

    const entryIndex = group.keyword_map.findIndex((entry) => entry.keyword == updated_entry.keyword);

    if (entryIndex != -1) {

      group.keyword_map[entryIndex] = updated_entry;

      group.save()
      .then(() => {

        return res.status(200).send(updated_entry);
      }).catch((err) => {

        console.error(err.message);
        return res.status(500).send();
      });
    } else {

      return res.status(404).send();
    }
  });
});

app.delete('/api/keywords/:group_id/:token/:keyword', (req, res) => {
  
  Group.findOne({group_id: req.params.group_id})
  .then(group => {

    const entryIndex = group.keyword_map.findIndex((entry) => entry.keyword == req.params.keyword);

    if (entryIndex != -1) {

      const removed_element = group.keyword_map.splice(entryIndex, 1);

      group.save()
      .then(() => {

        return res.status(200).send({response: "SUCCESS"});
      }).catch((err) => {

        console.error(err.message);
        return res.status(500).send();
      });
    } else {

      return res.status(404).send();
    }
  });
});