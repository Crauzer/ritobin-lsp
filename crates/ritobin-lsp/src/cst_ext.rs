use ltk_ritobin::{
    cst::{
        Cst, NodeId, TokenId, TreeKind,
        visitor::{Visit, VisitCtx, Visitor},
    },
    parse::Token,
};

pub trait CstExt {
    fn find_node(&self, byte_index: u32) -> Option<(Vec<TreeKind>, Token)>;
}

struct NodeFinder {
    stack: Vec<TreeKind>,
    offset: u32,
    found: Option<Token>,
}

impl NodeFinder {
    pub fn new(offset: u32) -> Self {
        Self {
            stack: Vec::new(),
            offset,
            found: None,
        }
    }
}

impl Visitor for NodeFinder {
    fn visit_token(&mut self, ctx: &VisitCtx, token: TokenId, _parent: NodeId) -> Visit {
        let token = ctx.cst.token(token).unwrap();
        if token.span.contains(self.offset) {
            self.found.replace(*token);
            return Visit::Stop;
        }

        Visit::Continue
    }

    fn enter_tree(&mut self, ctx: &VisitCtx, node: NodeId) -> Visit {
        let node = ctx.node(node).unwrap();
        self.stack.push(node.kind);
        Visit::Continue
    }
    fn exit_tree(&mut self, _ctx: &VisitCtx, _node: NodeId) -> Visit {
        self.stack.pop();
        Visit::Continue
    }
}

impl CstExt for Cst {
    fn find_node(&self, byte_index: u32) -> Option<(Vec<TreeKind>, Token)> {
        let mut visitor = NodeFinder::new(byte_index);

        self.walk(&mut visitor);

        visitor.found.map(|tok| (visitor.stack, tok))
    }
}
